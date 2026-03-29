# GitOps (Pipeline-as-Code)

VectorFlow supports **pipeline-as-code** workflows where pipeline configurations are stored in a Git repository and kept in sync between VectorFlow and your version control system.

## Supported Git Providers

VectorFlow supports the following Git hosting providers:

| Provider | Webhook Verification | API Operations |
|----------|---------------------|----------------|
| **GitHub** | HMAC-SHA256 (`X-Hub-Signature-256`) | Contents API, Pulls API |
| **GitLab** | Shared secret (`X-Gitlab-Token`) | Repository Files API, Merge Requests API |
| **Bitbucket** | HMAC-SHA256 (`X-Hub-Signature`) | Source API, Pullrequests API |

The provider is **auto-detected** from the repository URL domain (e.g., `github.com`, `gitlab.com`, `bitbucket.org`). For self-hosted instances (e.g., `gitlab.internal.corp`), you can explicitly set the provider in the Git Integration settings.

## Modes

Each environment can operate in one of four GitOps modes:

| Mode | Direction | Description |
|------|-----------|-------------|
| **Off** | -- | Git integration is disabled (default). |
| **Push Only** | VectorFlow -> Git | Pipeline YAML is committed to the repo whenever you deploy or delete a pipeline. The repo serves as an audit trail. |
| **Bi-directional** | VectorFlow <-> Git | In addition to push, a webhook from your Git provider triggers VectorFlow to import changed YAML files automatically. |
| **Promotion** | VectorFlow -> Git -> VectorFlow | Promoting a pipeline creates a pull request (or merge request). Merging it automatically deploys the promoted config. |

## Setting up Push Only

Push-only mode commits pipeline YAML files to your Git repository every time you deploy or delete a pipeline.

{% stepper %}
{% step %}
### Configure Git Integration
On the environment detail page, fill in the **Git Integration** card:
- **Repository URL** -- HTTPS URL of the target repo (e.g., `https://github.com/org/pipeline-configs.git`)
- **Branch** -- The branch to push to (default: `main`)
- **Access Token** -- A personal access token with write access
- **Git Provider** -- Leave as "Auto-detect" for hosted providers, or explicitly select for self-hosted instances
{% endstep %}
{% step %}
### Set GitOps Mode to Push Only
In the **GitOps Mode** dropdown, select **Push Only**.
{% endstep %}
{% step %}
### Save
Click **Save**. You can verify connectivity with **Test Connection** before saving.
{% endstep %}
{% endstepper %}

From this point forward, every pipeline deploy writes the generated YAML to `{environment-name}/{pipeline-name}.yaml` in the configured repository, and every pipeline deletion removes the file.

{% hint style="info" %}
Git sync is a post-deploy side effect. If the Git push fails, the pipeline deploy still succeeds -- VectorFlow automatically queues the failed sync for retry (up to 3 attempts with exponential backoff). You can monitor sync status in the **Git Sync Status** section on the environment page.
{% endhint %}

## Setting up Bi-directional GitOps

Bi-directional mode adds a webhook so that pushes to the Git repository automatically import or update pipelines in VectorFlow.

{% stepper %}
{% step %}
### Configure Git Integration
On the environment detail page, fill in the **Repository URL**, **Branch**, and **Access Token** in the Git Integration card.
{% endstep %}
{% step %}
### Set GitOps Mode to Bi-directional
Select **Bi-directional** from the **GitOps Mode** dropdown and click **Save**. VectorFlow auto-generates a webhook secret.
{% endstep %}
{% step %}
### Copy the webhook details
After saving, the card shows:
- **Webhook URL** -- The endpoint your Git provider should send push events to.
- **Webhook Secret** -- The secret for signature verification.
{% endstep %}
{% step %}
### Create a Webhook in your Git provider
{% endstep %}
{% endstepper %}

{% tabs %}
{% tab title="GitHub" %}
In your GitHub repository, go to **Settings > Webhooks > Add webhook**:
- **Payload URL** -- Paste the Webhook URL from VectorFlow.
- **Content type** -- Select `application/json`.
- **Secret** -- Paste the Webhook Secret from VectorFlow.
- **Events** -- Select **Just the push event** (and **Pull requests** if using Promotion mode).
{% endtab %}
{% tab title="GitLab" %}
In your GitLab project, go to **Settings > Webhooks > Add new webhook**:
- **URL** -- Paste the Webhook URL from VectorFlow.
- **Secret token** -- Paste the Webhook Secret from VectorFlow.
- **Trigger** -- Check **Push events** (and **Merge request events** if using Promotion mode).
{% endtab %}
{% tab title="Bitbucket" %}
In your Bitbucket repository, go to **Repository settings > Webhooks > Add webhook**:
- **URL** -- Paste the Webhook URL from VectorFlow.
- **Secret** -- Paste the Webhook Secret from VectorFlow.
- **Triggers** -- Select **Repository push** (and **Pull request merged/declined** if using Promotion mode).
{% endtab %}
{% endtabs %}

## How the import works

When a push event arrives:

1. VectorFlow verifies the webhook signature using the appropriate method for the Git provider.
2. It checks that the push targets the configured branch.
3. For each added or modified `.yaml` / `.yml` file in the push, it fetches the file content via the provider's API.
4. The pipeline name is derived from the filename (e.g., `production/my-pipeline.yaml` becomes `my-pipeline`).
5. If a pipeline with a matching `gitPath` or name already exists in the environment, its graph is replaced. Otherwise, a new pipeline is created.
6. If the environment has **Require Deploy Approval** enabled, imported pipelines are saved as drafts with a pending deploy request instead of being deployed immediately.

{% hint style="warning" %}
Bi-directional mode means the Git repository is the source of truth. Any manual edits made in the VectorFlow UI may be overwritten on the next push to the repository. The pipeline editor shows a banner to remind users of this.
{% endhint %}

## Pipeline Name / Filename Decoupling

VectorFlow uses a stable `gitPath` field to track the file path in Git for each pipeline. This means:

- **Renaming a pipeline** in VectorFlow does not change its filename in Git. The original path is preserved.
- **First sync** automatically assigns a `gitPath` based on the environment and pipeline name slugs.
- **Webhook imports** match files by `gitPath` first, then by name as a fallback.

This prevents broken sync when pipelines are renamed after initial setup.

## Sync Status and Retries

The **Git Sync Status** section on the environment detail page shows:

- **Health badge** -- Green (healthy), yellow (pending retries), or red (failed).
- **Last successful sync** timestamp.
- **Recent sync jobs** with status, attempt count, and per-job retry buttons.
- **Import errors** from webhook events (YAML parse failures, invalid filenames, etc.).

Failed sync operations are automatically retried up to 3 times with exponential backoff (30 seconds, 2 minutes, 10 minutes). After all retries are exhausted, a `git_sync_failed` alert is fired (if subscribed). You can also manually retry failed jobs from the UI.

The environment list page shows a warning badge when an environment has unresolved sync failures.

## File layout

VectorFlow expects pipeline YAML files to follow the standard Vector configuration format:

```
repo-root/
  environment-name/
    pipeline-a.yaml
    pipeline-b.yaml
  other-environment/
    pipeline-c.yaml
```

The directory name should match the slugified environment name. Files must have a `.yaml` or `.yml` extension.

## Disabling GitOps

To disable GitOps, set the mode back to **Off** and click **Save**. The webhook secret is cleared, and incoming webhook requests will be rejected.
