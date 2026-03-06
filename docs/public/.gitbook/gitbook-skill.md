# GitBook Documentation Editing Skill

This guide enables AI tools to write GitBook-compatible markdown.

## Key Formatting Elements

GitBook extends standard markdown with custom blocks:

### Tabs
{% tabs %}
{% tab title="Docker" %}
Content for Docker tab
{% endtab %}
{% tab title="Standalone" %}
Content for Standalone tab
{% endtab %}
{% endtabs %}

### Hints / Callouts
{% hint style="info" %}
Informational callout
{% endhint %}

{% hint style="warning" %}
Warning callout
{% endhint %}

{% hint style="danger" %}
Danger callout
{% endhint %}

{% hint style="success" %}
Success callout
{% endhint %}

### Steppers
{% stepper %}
{% step %}
### Step Title
Step content
{% endstep %}
{% endstepper %}

### Expandable Content
<details>
<summary>Click to expand</summary>
Hidden content here
</details>

## Configuration

- **.gitbook.yaml** -- Space configuration (root directory, readme/summary paths)
- **SUMMARY.md** -- Table of contents defining sidebar navigation
- **/.gitbook/vars.yaml** -- Space-level reusable variables

## Writing Guidelines

- Use hierarchical headings (H1-H3)
- Keep paragraphs short, use bullet points
- Include code snippets and practical examples
- Minimize jargon
- Use tabs for platform-specific content (Docker vs Standalone, Linux vs macOS)
- Use hints for important callouts
- Use steppers for sequential procedures
