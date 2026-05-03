# Deploy State Machine

This document describes the deploy path that starts when a pipeline is edited and ends when agents report runtime status. It is for maintainers and operators who need to reason about deploy approvals, rollback, concurrent deploy attempts, and agent status.

The post-read action is: decide whether a deploy, approval, rollback, agent poll, or heartbeat transition is valid without reading the implementation.

## State Owners

VectorFlow splits deployment state across five records:

| Record | Owns | Important states |
| --- | --- | --- |
| Pipeline | Whether the pipeline is draft or deployed, plus current editor graph and node selector | Draft, deployed, undeployed |
| Pipeline version | Immutable deployed snapshot of generated YAML, global config, nodes, and edges | Version numbers increase monotonically |
| Deploy request | Approval workflow for environments that require review | Pending, approved, rejected, cancelled, deployed |
| Agent config response | The versioned configs a node should run after polling | Omitted, delivered |
| Node pipeline status | Runtime status reported by heartbeats | Pending, starting, running, stopped, crashed |

Pipeline edits change the live pipeline graph only. Agents never receive live graph edits directly. Agents receive the latest pipeline version snapshot only after a deploy path creates a new version and marks the pipeline deployed.

## Pipeline And Version Transitions

| From | Event | To | Result |
| --- | --- | --- | --- |
| Draft or deployed pipeline with edited graph | Deploy preview | Same state | Generated YAML and validation result are returned; no version is created. |
| Draft or deployed pipeline | Direct deploy succeeds | Deployed with a new version | A new immutable version is created from the current graph, the pipeline is marked deployed, matching agents are notified to poll. |
| Draft or deployed pipeline | Direct deploy validation fails | Same state | No version is created and the pipeline is not marked deployed. |
| Draft or deployed pipeline in an approval-required environment | Editor submits deploy | Pending deploy request | The generated YAML snapshot is stored on the request; agents do not receive it yet. |
| Approved deploy request | Execute succeeds | Deployed with a new version | A new version is created from the reviewed request YAML snapshot, not from the current editor graph. |
| Approved deploy request | Execute fails without throwing | Approved deploy request | The request is reverted to approved so it can be retried. |
| Approved deploy request | Execute throws | Approved deploy request | The request is reverted to approved and the caller receives a deploy failure. |
| Deployed pipeline | Undeploy succeeds | Draft and undeployed | Agents stop receiving the pipeline on the next config poll. |
| Pipeline with historical versions | Deploy from version or rollback succeeds | Deployed with a new version | A new latest version is created by copying the chosen historical version. History is preserved. |

Invalid edges:

| Attempt | Outcome |
| --- | --- |
| Deploy a missing pipeline | Rejected as not found. |
| Deploy with invalid generated YAML | Rejected; no version is created. |
| Deploy from a version that belongs to another pipeline | Rejected as a bad request. |
| Deploy from a missing historical version | Rejected as not found. |
| Editor deploys from historical version in an approval-required environment | Rejected; only admins can bypass approval for that path. |
| Agent poll after editor-only changes | Agents still receive the last deployed version, not the edited graph. |

## Deploy Request Transitions

Deploy requests exist only when an environment requires approval and the requester does not have direct deploy authority.

| From | Event | To | Notes |
| --- | --- | --- | --- |
| None | Editor submits deploy | Pending | The request stores the reviewed YAML snapshot, changelog, and optional node selector. |
| Pending | Reviewer approves | Approved | The claim is atomic: only a still-pending request can move to approved. |
| Pending | Reviewer rejects | Rejected | Terminal. The review note is stored when provided. |
| Pending | Requester cancels | Cancelled | Terminal. Only the requester can cancel while pending. |
| Approved | Deploy executor claims request | Deployed | The claim is atomic: only a still-approved request can move to deployed. |
| Approved | Deploy execution fails | Approved | The request is put back so a reviewer or operator can retry. |
| Approved | Deploy-capable user cancels | Cancelled | Terminal. |

Invalid edges:

| Attempt | Outcome |
| --- | --- |
| Create a second pending request for the same pipeline | Rejected as a conflict. |
| Approve a request that is not pending | Rejected. |
| Approve your own request through the UI path | Rejected. |
| Reject a request that is not pending | Rejected. |
| Execute a request that is not approved | Rejected. |
| Execute the same approved request twice | First atomic claim wins; later attempts are rejected. |
| Cancel a deployed, rejected, or already-cancelled request | Rejected. |

## Agent Config Transitions

Agents poll for configuration after enrollment or after a push notification. Push is only a hint; the config poll is the source of truth.

| Pipeline state at poll time | Node selector match | Agent receives |
| --- | --- | --- |
| Draft or undeployed | Any | No pipeline config. |
| Deployed with no versions | Any | No pipeline config. |
| Deployed with latest version | Selector absent or empty | Latest version snapshot. |
| Deployed with latest version | Selector matches node labels | Latest version snapshot. |
| Deployed with latest version | Selector does not match node labels | No pipeline config. |
| Node in maintenance mode | Any | No pipeline config. |

The config response is assembled from the immutable latest version. Secret and certificate references are resolved at poll time for built-in secret storage, so secret rotation can change the delivered checksum without creating a new pipeline version.

Invalid edges:

| Attempt | Outcome |
| --- | --- |
| Unauthenticated config poll | Rejected. |
| Poll for an environment that no longer exists | Rejected as not found. |
| Config snapshot cannot be parsed or resolved for one pipeline | That pipeline is skipped for the response; other pipelines can still be returned. |
| Node labels do not satisfy the pipeline selector | The pipeline is omitted. |

## Heartbeat Transitions

Agents report runtime status after applying config. The heartbeat path updates node health, node metadata, pipeline runtime rows, logs, metrics, and browser events.

| From | Heartbeat input | To |
| --- | --- | --- |
| Any node status | Authenticated heartbeat | Node becomes healthy and last-seen timestamps update. |
| Previous node status is not healthy | Authenticated heartbeat | A node status transition event is recorded and broadcast. |
| No node-pipeline status row | Reported pipeline status | A row is inserted for that node and pipeline. |
| Existing node-pipeline status row | Reported pipeline status changed | The row is updated and a pipeline status transition is broadcast. |
| Existing node-pipeline status row | Pipeline omitted from heartbeat | The row is deleted for that node. |

Invalid edges:

| Attempt | Outcome |
| --- | --- |
| Unauthenticated heartbeat | Rejected. |
| Malformed heartbeat body | Rejected. |
| Heartbeat reports a pipeline outside the node environment | That pipeline status is ignored. |
| Heartbeat omits a previously reported pipeline | The server treats it as no longer running on that node and removes the status row. |

## Rollback

Rollback does not mutate a historical version. It creates a new latest version whose YAML, global config, nodes, and edges are copied from the chosen historical version. That means:

- Rollback is auditable because the version number advances.
- Agents receive rollback like any other deploy: by polling and receiving the new latest version.
- Heartbeat status must still come from agents after they apply the rolled-back config.
- A rollback target from another pipeline is invalid.

## Concurrent Deploy Resolution

VectorFlow resolves concurrency with atomic state claims rather than long-running locks:

- Pending deploy requests are unique by behavior: when creating a request, the server checks for an existing pending request inside a serializable transaction.
- Approval claims only update requests that are still pending.
- Execution claims only update requests that are still approved.
- If two executors race, one moves the request to deployed and the other receives a rejection because the request is no longer approved.
- If execution fails after the request was claimed, the request is reverted to approved so retry is explicit and visible.

These rules keep the deploy path idempotent at the workflow level: clients may retry after transport failures, but they must re-read request state before assuming another deploy should be started.
