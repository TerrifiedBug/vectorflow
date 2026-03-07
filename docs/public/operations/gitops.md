# GitOps (Pipeline-as-Code)

VectorFlow supports **pipeline-as-code** workflows where pipeline configurations are stored in a Git repository and kept in sync between VectorFlow and your version control system.

## Modes

Each environment can operate in one of three GitOps modes:

| Mode | Direction | Description |
|------|-----------|-------------|
| **Off** | -- | Git integration is disabled (default). |
| **Push Only** | VectorFlow -> Git | Pipeline YAML is committed to the repo whenever you deploy or delete a pipeline. The repo serves as an audit trail. |
| **Bi-directional** | VectorFlow <-> Git | In addition to push, a webhook from GitHub triggers VectorFlow to import changed YAML files automatically. |

## Setting up Push Only

Push-only mode commits pipeline YAML files to your Git repository every time you deploy or delete a pipeline.

{% stepper %}
{% step %}
### Configure Git Integration
On the environment detail page, fill in the **Git Integration** card:
- **Repository URL** -- HTTPS URL of the target repo (e.g., `https://github.com/org/pipeline-configs.git`)
- **Branch** -- The branch to push to (default: `main`)
- **Access Token** -- A personal access token with write access
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
Git sync is a post-deploy side effect. If the Git push fails, the pipeline deploy still succeeds -- you will see a warning in the VectorFlow logs.
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
- **Webhook URL** -- The endpoint GitHub should send push events to.
- **Webhook Secret** -- The HMAC secret for signature verification.
{% endstep %}
{% step %}
### Create a GitHub Webhook
In your GitHub repository, go to **Settings > Webhooks > Add webhook** and enter:
- **Payload URL** -- Paste the Webhook URL from VectorFlow.
- **Content type** -- Select `application/json`.
- **Secret** -- Paste the Webhook Secret from VectorFlow.
- **Events** -- Select **Just the push event**.

Click **Add webhook**.
{% endstep %}
{% endstepper %}

{% tabs %}
{% tab title="GitHub" %}
Navigate to your repository on GitHub, then go to **Settings > Webhooks > Add webhook**. Fill in the Payload URL, select `application/json`, paste the secret, and choose the push event.
{% endtab %}
{% tab title="GitLab" %}
GitLab uses a different header (`X-Gitlab-Token`) for secret verification. GitLab support is not yet available -- contact the team if you need it.
{% endtab %}
{% endtabs %}

## How the import works

When a push event arrives:

1. VectorFlow verifies the HMAC signature using the webhook secret.
2. It checks that the push targets the configured branch.
3. For each added or modified `.yaml` / `.yml` file in the push, it fetches the file content via the GitHub API.
4. The pipeline name is derived from the filename (e.g., `production/my-pipeline.yaml` becomes `my-pipeline`).
5. If a pipeline with that name already exists in the environment, its graph is replaced. Otherwise, a new pipeline is created.

{% hint style="warning" %}
Bi-directional mode means the Git repository is the source of truth. Any manual edits made in the VectorFlow UI may be overwritten on the next push to the repository. The pipeline editor shows a banner to remind users of this.
{% endhint %}

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
