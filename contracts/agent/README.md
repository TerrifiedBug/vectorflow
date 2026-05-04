# Agent Payload Contracts

`contracts/agent/v1` is the source of truth for JSON exchanged between the
Next.js server and the Go agent. Payload changes must update the contract,
fixtures, and both TypeScript and Go fixture tests in the same PR.

Current v1 coverage:

- `SampleResultsRequestPayload`: `POST /api/agent/samples`
- `ConfigResponsePayload`: `GET /api/agent/config`
- `HeartbeatRequestPayload`: `POST /api/agent/heartbeat`
- `LogBatchPayload[]`: `POST /api/agent/logs`
- `TapEventPayload`: `POST /api/agent/tap-events`
- `PushMessagePayload`: `GET /api/agent/push` SSE message data

The Go agent structs are validated against the shared JSON fixtures in
`agent/internal/client/client_contract_test.go`,
`agent/internal/push/push_contract_test.go`, and
`agent/internal/tapper/tapper_contract_test.go`. The server imports route
schemas directly from `contracts/agent/v1/payloads.ts`.
