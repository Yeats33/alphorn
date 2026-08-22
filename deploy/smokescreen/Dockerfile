FROM golang:1.25-alpine AS build

ARG SMOKESCREEN_REF=f03c477dc9f4fe3252ae96ad9274d53108b2c53c

RUN apk add --no-cache ca-certificates git
WORKDIR /src
RUN git init \
    && git remote add origin https://github.com/stripe/smokescreen.git \
    && git fetch --depth=1 origin "${SMOKESCREEN_REF}" \
    && git checkout --detach FETCH_HEAD
RUN CGO_ENABLED=0 go build -mod=vendor -trimpath -ldflags="-s -w" -o /smokescreen .

FROM alpine:3.22

RUN apk add --no-cache ca-certificates \
    && addgroup -S smokescreen \
    && adduser -S -G smokescreen smokescreen

COPY --from=build /smokescreen /usr/local/bin/smokescreen

USER smokescreen
EXPOSE 4750
ENTRYPOINT ["/usr/local/bin/smokescreen"]
