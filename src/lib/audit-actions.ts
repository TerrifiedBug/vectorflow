/**
 * Human-readable labels for audit log actions.
 *
 * The key is the raw action string stored in the database (from withAudit()).
 * The value is the friendly label shown in the UI.
 */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Pipeline
  "pipeline.created": "Pipeline created",
  "pipeline.system_created": "Pipeline auto-created",
  "pipeline.updated": "Pipeline updated",
  "pipeline.deleted": "Pipeline deleted",
  "pipeline.cloned": "Pipeline cloned",
  "pipeline.promoted": "Pipeline promoted",
  "pipeline.graph_saved": "Pipeline graph saved",
  "pipeline.changes_discarded": "Pipeline changes discarded",
  "pipeline.rollback": "Pipeline rolled back",
  "pipeline.batch_deployed": "Batch deployment",
  "pipeline.sli_upserted": "SLI updated",
  "pipeline.sli_deleted": "SLI deleted",
  "pipeline.ai_conversation_started": "AI conversation started",
  "pipeline.ai_suggestion_applied": "AI suggestion applied",
  "pipeline.vrl_ai_suggestion_applied": "VRL AI suggestion applied",

  // Deploy
  "deploy.agent": "Deployed to agent",
  "deploy.from_version": "Deployed from version",
  "deploy.undeploy": "Undeployed",
  "deploy.request_submitted": "Deploy request submitted",
  "deploy.cancel_request": "Deploy request cancelled",
  "deploy.staged_created": "Staged rollout created",
  "deploy.staged_broadened": "Staged rollout broadened",
  "deploy.staged_rolled_back": "Staged rollback",
  "deploy.staged_auto": "Staged auto-promotion",
  "deploy.auto_rollback": "Auto-rollback triggered",

  // Deploy Requests
  "deployRequest.approved": "Deploy request approved",
  "deployRequest.deployed": "Deploy request executed",
  "deployRequest.rejected": "Deploy request rejected",

  // Environment
  "environment.created": "Environment created",
  "environment.updated": "Environment updated",
  "environment.deleted": "Environment deleted",
  "environment.gitConnection.tested": "Git connection tested",
  "environment.enrollmentToken.generated": "Enrollment token generated",
  "environment.enrollmentToken.revoked": "Enrollment token revoked",

  // Team
  "team.created": "Team created",
  "team.deleted": "Team deleted",
  "team.renamed": "Team renamed",
  "team.updated": "Team updated",
  "team.member_added": "Member added to team",
  "team.member_removed": "Member removed from team",
  "team.member_role_updated": "Member role updated",
  "team.member_locked": "Member locked",
  "team.member_unlocked": "Member unlocked",
  "team.member_password_reset": "Member password reset",
  "team.require_2fa_updated": "2FA requirement updated",
  "team.member_linked_oidc": "Member linked to SSO",
  "team.ai_config_updated": "AI config updated",
  "team.ai_connection_tested": "AI connection tested",

  // User
  "user.password_changed": "Password changed",
  "user.profile_updated": "Profile updated",
  "user.totp_setup_started": "2FA setup started",
  "user.totp_enabled": "2FA enabled",
  "user.totp_disabled": "2FA disabled",

  // Admin
  "admin.user_assigned_to_team": "User assigned to team",
  "admin.super_admin_toggled": "Super admin toggled",
  "admin.user_created": "User created",
  "admin.user_removed_from_team": "User removed from team",
  "admin.user_locked": "User locked",
  "admin.user_unlocked": "User unlocked",
  "admin.password_reset": "Password reset by admin",

  // Fleet
  "fleet.node.created": "Node registered",
  "fleet.node.updated": "Node updated",
  "fleet.node.deleted": "Node deleted",
  "fleet.node.revoked": "Node revoked",
  "node.update_triggered": "Agent update triggered",
  "node.maintenance_toggled": "Maintenance mode toggled",
  "vectorNode.updated": "Node labels updated",

  // Alerts
  "alertRule.created": "Alert rule created",
  "alertRule.updated": "Alert rule updated",
  "alertRule.deleted": "Alert rule deleted",
  "alertRule.snoozed": "Alert rule snoozed",
  "alertRule.unsnoozed": "Alert rule unsnoozed",
  "alertEvent.acknowledged": "Alert acknowledged",
  "alertGroup.acknowledged": "Alert group acknowledged",
  "alert.retryDelivery": "Alert delivery retried",
  "alert.retryAllForChannel": "All deliveries retried for channel",

  // Notification Channels
  "notificationChannel.created": "Notification channel created",
  "notificationChannel.updated": "Notification channel updated",
  "notificationChannel.deleted": "Notification channel deleted",
  "notificationChannel.tested": "Notification channel tested",

  // Secrets & Certificates
  "secret.created": "Secret created",
  "secret.updated": "Secret updated",
  "secret.deleted": "Secret deleted",
  "secret.accessed": "Secret accessed",
  "certificate.uploaded": "Certificate uploaded",
  "certificate.deleted": "Certificate deleted",
  "certificate.accessed": "Certificate accessed",

  // Settings
  "settings.oidc_updated": "OIDC settings updated",
  "settings.oidc_role_mapping_updated": "OIDC role mapping updated",
  "settings.oidc_team_mapping_updated": "OIDC team mapping updated",
  "settings.fleet_updated": "Fleet settings updated",
  "settings.anomaly_config_updated": "Anomaly config updated",
  "settings.backup_created": "Backup created",
  "settings.backup_deleted": "Backup deleted",
  "settings.backup_restored": "Backup restored",
  "settings.backup_schedule_updated": "Backup schedule updated",
  "settings.storage_backend_updated": "Storage backend updated",
  "settings.scim_updated": "SCIM settings updated",
  "settings.scim_token_generated": "SCIM token generated",

  // Shared Components
  "shared_component.created": "Shared component created",
  "shared_component.updated": "Shared component updated",
  "shared_component.deleted": "Shared component deleted",
  "shared_component.update_accepted": "Component update accepted",
  "shared_component.bulk_update_accepted": "Bulk component update accepted",
  "shared_component.unlinked": "Component unlinked",
  "shared_component.linked": "Component linked",

  // VRL Snippets
  "vrlSnippet.created": "VRL snippet created",
  "vrlSnippet.updated": "VRL snippet updated",
  "vrlSnippet.deleted": "VRL snippet deleted",

  // Service Accounts
  "serviceAccount.created": "Service account created",
  "serviceAccount.revoked": "Service account revoked",
  "serviceAccount.deleted": "Service account deleted",

  // Webhook Endpoints
  "webhookEndpoint.created": "Webhook endpoint created",
  "webhookEndpoint.updated": "Webhook endpoint updated",
  "webhookEndpoint.deleted": "Webhook endpoint deleted",
  "webhookEndpoint.toggled": "Webhook endpoint toggled",
  "webhookEndpoint.testDelivery": "Webhook test delivery",

  // Filter Presets
  "filterPreset.create": "Filter preset created",
  "filterPreset.update": "Filter preset updated",
  "filterPreset.delete": "Filter preset deleted",
  "filterPreset.setDefault": "Default filter preset set",
  "filterPreset.clearDefault": "Default filter preset cleared",

  // Dashboard Views
  "dashboard.create_view": "Dashboard view created",
  "dashboard.update_view": "Dashboard view updated",
  "dashboard.delete_view": "Dashboard view deleted",

  // Pipeline Groups
  "pipelineGroup.created": "Pipeline group created",
  "pipelineGroup.updated": "Pipeline group updated",
  "pipelineGroup.deleted": "Pipeline group deleted",

  // Pipeline Dependencies
  "pipelineDependency.created": "Pipeline dependency created",
  "pipelineDependency.deleted": "Pipeline dependency deleted",

  // Templates
  "template.created": "Template created",
  "template.deleted": "Template deleted",

  // Promotions
  "promotion.initiated": "Promotion initiated",
  "promotion.approved": "Promotion approved",
  "promotion.rejected": "Promotion rejected",
  "promotion.cancelled": "Promotion cancelled",

  // Migrations
  "migration.created": "Migration project created",
  "migration.deleted": "Migration project deleted",
  "migration.translated": "Migration translated",
  "migration.generated": "Migration pipeline generated",

  // Cost Recommendations
  "cost_recommendation.dismiss": "Cost recommendation dismissed",
  "cost_recommendation.apply": "Cost recommendation applied",
  "cost_recommendation.trigger_analysis": "Cost analysis triggered",

  // Node Groups
  "nodeGroup.created": "Node group created",
  "nodeGroup.updated": "Node group updated",
  "nodeGroup.deleted": "Node group deleted",
};

/**
 * Get a human-readable label for an audit action.
 * Falls back to the raw action string if no label is defined.
 */
export function getAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
