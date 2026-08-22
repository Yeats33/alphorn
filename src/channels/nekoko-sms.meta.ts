import type { ChannelMeta } from "./meta-types";

export const meta: ChannelMeta = {
  type: "nekoko-sms",
  displayName: "Nekoko SMS",
  description: "Send SMS notifications through the Nekoko Telecom API",
  icon: "nekoko-sms",
  hasTest: true,
  setupGuide: [
    "**Step 1: Rotate the exposed API key**",
    "Create a fresh API key before configuring this channel. The previous key appeared in a URL and should no longer be trusted.",
    "",
    "**Step 2: Configure the numbers**",
    "Enter the sender and recipient numbers accepted by your Nekoko account.",
    "",
    "**Step 3: Test carefully**",
    "The **Send test message** button sends a real SMS and may incur a charge.",
  ].join("\n"),
  configFields: [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      required: true,
      helpText: "Use a newly rotated Nekoko API key",
    },
    {
      key: "from",
      label: "From Number",
      type: "text",
      required: true,
      helpText: "Sender number assigned to your Nekoko account",
      placeholder: "372...",
    },
    {
      key: "to",
      label: "To Number",
      type: "text",
      required: true,
      helpText: "Recipient number for notifications",
      placeholder: "372...",
    },
  ],
};
