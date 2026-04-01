# Pipeline Dependencies

Pipeline dependencies let you model upstream/downstream relationships between pipelines within the same environment. VectorFlow uses these relationships to warn you at deploy time, visualize data flow, and prevent configuration mistakes.

## What are dependencies?

A dependency means "Pipeline B depends on Pipeline A." In this relationship:

- **Pipeline A** is the **upstream** -- it produces data that Pipeline B consumes.
- **Pipeline B** is the **downstream** -- it relies on Pipeline A being deployed and running.

Dependencies are always within a single environment. You cannot create cross-environment dependencies.

## Creating a dependency

{% stepper %}
{% step %}
### Open the pipeline editor
Navigate to the pipeline you want to add a dependency to and open it in the editor.
{% endstep %}
{% step %}
### Open the Dependencies tab
In the pipeline detail panel, click the **Dependencies** tab to see existing upstream dependencies.
{% endstep %}
{% step %}
### Add a dependency
Click **Add Dependency** and select the upstream pipeline from the dropdown. Only pipelines in the same environment are shown as candidates.
{% endstep %}
{% step %}
### Save
The dependency is saved immediately. You can optionally add a description to document why the relationship exists.
{% endstep %}
{% endstepper %}

{% hint style="info" %}
Adding or removing dependencies requires the **Editor** role or above on the team.
{% endhint %}

## Removing a dependency

From the Dependencies tab, click the remove button next to any upstream dependency. The relationship is removed immediately.

## DAG visualization

The **Dependency Graph** page (accessible from the environment sidebar) renders all pipelines and their dependencies as a directed acyclic graph (DAG). Each node in the graph represents a pipeline, and edges show the upstream-to-downstream flow.

The graph helps you:

- Understand the overall data flow across your environment
- Identify pipelines with many dependents (high fan-out)
- Spot isolated pipelines with no relationships

Pipeline nodes are color-coded by status: deployed pipelines appear in their normal color, while draft (undeployed) pipelines are visually distinct.

## Deployment order implications

VectorFlow uses dependencies to surface warnings during deployment:

- **Deploying a downstream pipeline** -- If any of its upstream dependencies are not yet deployed (still in draft), VectorFlow shows a warning listing the undeployed upstreams. You can still proceed, but the warning helps you avoid deploying a consumer before its producer is ready.
- **Undeploying an upstream pipeline** -- If any downstream pipelines are currently deployed and depend on the pipeline you are undeploying, VectorFlow warns you that those pipelines may lose their data source.

These are advisory warnings only -- they do not block deployment. The goal is to keep you informed so you can coordinate rollouts across related pipelines.

## Cycle prevention

VectorFlow enforces that the dependency graph must be a DAG (directed acyclic graph). When you attempt to add a dependency that would create a circular loop, the operation is rejected with an error:

> Cannot add: would create a circular dependency

For example, if Pipeline A depends on Pipeline B, and Pipeline B depends on Pipeline C, you cannot make Pipeline C depend on Pipeline A because that would form a cycle (A -> B -> C -> A).

The cycle detection algorithm runs automatically whenever you add a new dependency. It traverses the existing graph to verify that no loop would be created before persisting the relationship.

{% hint style="warning" %}
Self-references are also prevented -- a pipeline cannot depend on itself.
{% endhint %}
