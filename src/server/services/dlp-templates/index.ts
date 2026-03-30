// src/server/services/dlp-templates/index.ts
export type { DlpTemplateDefinition, DlpTemplateParam, DlpTestFixture } from "./types";

export { CREDIT_CARD_MASKING } from "./credit-card-masking";
export { SSN_MASKING } from "./ssn-masking";
export { EMAIL_REDACTION } from "./email-redaction";
export { IP_ANONYMIZATION } from "./ip-anonymization";
export { PHONE_MASKING } from "./phone-masking";
export { API_KEY_REDACTION } from "./api-key-redaction";
export { CUSTOM_REGEX_MASKING } from "./custom-regex-masking";
export { JSON_FIELD_REMOVAL } from "./json-field-removal";

import { CREDIT_CARD_MASKING } from "./credit-card-masking";
import { SSN_MASKING } from "./ssn-masking";
import { EMAIL_REDACTION } from "./email-redaction";
import { IP_ANONYMIZATION } from "./ip-anonymization";
import { PHONE_MASKING } from "./phone-masking";
import { API_KEY_REDACTION } from "./api-key-redaction";
import { CUSTOM_REGEX_MASKING } from "./custom-regex-masking";
import { JSON_FIELD_REMOVAL } from "./json-field-removal";

import type { DlpTemplateDefinition } from "./types";

export const ALL_DLP_TEMPLATES: readonly DlpTemplateDefinition[] = [
  CREDIT_CARD_MASKING,
  SSN_MASKING,
  EMAIL_REDACTION,
  IP_ANONYMIZATION,
  PHONE_MASKING,
  API_KEY_REDACTION,
  CUSTOM_REGEX_MASKING,
  JSON_FIELD_REMOVAL,
] as const;
