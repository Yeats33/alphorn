import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  getQueue: vi.fn(),
  loggerChild: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  advanceFailover: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    delivery: {
      updateMany: mocks.updateMany,
      findMany: mocks.findMany,
    },
  },
}));

vi.mock("@/lib/queue", () => ({
  DELIVERY_QUEUE: "delivery",
  getQueue: mocks.getQueue,
}));

vi.mock("@/lib/logger", () => {
  const logger = {
    child: mocks.loggerChild,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    debug: vi.fn(),
  };
  mocks.loggerChild.mockImplementation(() => logger);
  return { logger };
});

vi.mock("@/worker/failover", () => ({
  advanceFailoverIfLevelFailed: mocks.advanceFailover,
}));

describe("startSweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:00:00Z"));
    mocks.updateMany.mockReset();
    mocks.findMany.mockReset();
    mocks.getQueue.mockReset();
    mocks.loggerInfo.mockReset();
    mocks.loggerWarn.mockReset();
    mocks.loggerError.mockReset();
    mocks.advanceFailover.mockReset().mockResolvedValue({ state: "exhausted" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks stale deliveries and re-enqueues orphaned ones on each interval", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    mocks.updateMany.mockResolvedValue({ count: 2 });
    mocks.findMany
      .mockResolvedValueOnce([
        { id: "del_1", messageId: "msg_1", level: 1 },
        { id: "del_2", messageId: "msg_1", level: 1 },
      ])
      .mockResolvedValueOnce([{ id: "del_1" }, { id: "del_2" }]);
    mocks.getQueue.mockResolvedValue({ insert });

    const { startSweep } = await import("@/worker/sweep");
    startSweep();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["del_1", "del_2"] },
        status: "PENDING",
        attempts: 0,
      },
      data: {
        status: "STALE",
        lastError: "Delivery was never picked up by a worker",
      },
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        status: "PENDING",
        attempts: 0,
        updatedAt: {
          lt: new Date("2026-04-08T11:59:00.000Z"),
          gte: new Date("2026-04-08T11:56:00.000Z"),
        },
      },
      select: { id: true },
      take: 500,
    });
    expect(insert).toHaveBeenCalledWith("delivery", [
      { data: { deliveryId: "del_1" } },
      { data: { deliveryId: "del_2" } },
    ]);
    expect(mocks.advanceFailover).toHaveBeenCalledOnce();
    expect(mocks.advanceFailover).toHaveBeenCalledWith({
      messageId: "msg_1",
      failedLevel: 1,
    });
  });

  it("skips queue startup when there are no orphaned deliveries", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findMany.mockResolvedValue([]);

    const { startSweep } = await import("@/worker/sweep");
    startSweep();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.getQueue).not.toHaveBeenCalled();
  });

  it("catches and logs sweep failures without throwing", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "del_1", messageId: "msg_1", level: 1 },
    ]);
    mocks.updateMany.mockRejectedValue(new Error("db issue"));

    const { startSweep } = await import("@/worker/sweep");

    expect(() => startSweep()).not.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      { error: "db issue" },
      "Sweep failed"
    );
  });

  it("stringifies non-Error failures when logging", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "del_1", messageId: "msg_1", level: 1 },
    ]);
    mocks.updateMany.mockRejectedValue("boom");

    const { startSweep } = await import("@/worker/sweep");
    startSweep();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      { error: "boom" },
      "Sweep failed"
    );
  });
});
