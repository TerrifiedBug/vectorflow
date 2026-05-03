{{/*
Expand the name of the chart.
*/}}
{{- define "vectorflow-server.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncate at 63 chars because some Kubernetes name fields are limited.
*/}}
{{- define "vectorflow-server.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart label value.
*/}}
{{- define "vectorflow-server.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "vectorflow-server.labels" -}}
helm.sh/chart: {{ include "vectorflow-server.chart" . }}
{{ include "vectorflow-server.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "vectorflow-server.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vectorflow-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "vectorflow-server.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "vectorflow-server.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the secret that holds NEXTAUTH_SECRET, DATABASE_URL, etc.
*/}}
{{- define "vectorflow-server.secretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- include "vectorflow-server.fullname" . }}
{{- end }}
{{- end }}

{{/*
Resolve the DATABASE_URL: prefer existingSecret, then bundled postgresql, then secret.databaseUrl.
Returns the envFrom/env block for database URL injection.
*/}}
{{- define "vectorflow-server.databaseUrlEnv" -}}
{{- if .Values.existingSecret }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.existingSecret }}
      key: DATABASE_URL
{{- else if .Values.postgresql.enabled }}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-postgresql" .Release.Name }}
      key: password
- name: DATABASE_URL
  value: {{ printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s-postgresql:5432/%s" .Values.postgresql.auth.username .Release.Name .Values.postgresql.auth.database | quote }}
{{- else }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "vectorflow-server.secretName" . }}
      key: DATABASE_URL
{{- end }}
{{- end }}

{{/*
Redis URL env var — only injected when Redis is configured.
*/}}
{{- define "vectorflow-server.redisUrlEnv" -}}
{{- if .Values.redis.enabled }}
- name: REDIS_URL
  value: {{ printf "redis://%s-redis-master:6379" (include "vectorflow-server.fullname" .) | quote }}
{{- else if and (not .Values.existingSecret) .Values.secret.redisUrl }}
- name: REDIS_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "vectorflow-server.secretName" . }}
      key: REDIS_URL
{{- else if .Values.existingSecret }}
- name: REDIS_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.existingSecret }}
      key: REDIS_URL
      optional: true
{{- end }}
{{- end }}

{{/*
True when more than one server pod can run concurrently.
*/}}
{{- define "vectorflow-server.haEnabled" -}}
{{- if or (and (not .Values.autoscaling.enabled) (gt (int .Values.replicaCount) 1)) (and .Values.autoscaling.enabled (gt (int .Values.autoscaling.maxReplicas) 1)) -}}
true
{{- else -}}
false
{{- end -}}
{{- end }}

{{/*
True when the chart has a Redis URL source for leader election and pub/sub.
*/}}
{{- define "vectorflow-server.redisConfigured" -}}
{{- if or .Values.redis.enabled .Values.existingSecret .Values.secret.redisUrl -}}
true
{{- else -}}
false
{{- end -}}
{{- end }}
