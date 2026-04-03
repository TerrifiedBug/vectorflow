{{/*
Expand the name of the chart.
*/}}
{{- define "vectorflow-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "vectorflow-agent.fullname" -}}
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
{{- define "vectorflow-agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "vectorflow-agent.labels" -}}
helm.sh/chart: {{ include "vectorflow-agent.chart" . }}
{{ include "vectorflow-agent.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "vectorflow-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vectorflow-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "vectorflow-agent.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "vectorflow-agent.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Agent data volume definition.
*/}}
{{- define "vectorflow-agent.agentDataVolume" -}}
{{- if .Values.persistence.agentData.hostPath }}
hostPath:
  path: {{ .Values.persistence.agentData.hostPath }}
  type: DirectoryOrCreate
{{- else }}
persistentVolumeClaim:
  claimName: {{ .Values.persistence.agentData.existingClaim | default (printf "%s-agent-data" (include "vectorflow-agent.fullname" .)) }}
{{- end }}
{{- end }}

{{/*
Vector data volume definition.
*/}}
{{- define "vectorflow-agent.vectorDataVolume" -}}
{{- if .Values.persistence.vectorData.hostPath }}
hostPath:
  path: {{ .Values.persistence.vectorData.hostPath }}
  type: DirectoryOrCreate
{{- else }}
persistentVolumeClaim:
  claimName: {{ .Values.persistence.vectorData.existingClaim | default (printf "%s-vector-data" (include "vectorflow-agent.fullname" .)) }}
{{- end }}
{{- end }}
