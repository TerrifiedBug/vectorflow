/**
 * Accessible toast helpers that ensure proper ARIA roles.
 *
 * - success/info/loading → role="status" (polite, non-interruptive)
 * - error/warning → role="alert" (assertive, immediate announcement)
 *
 * Sonner handles ARIA attributes internally via its `role` and `ariaLive`
 * properties in ExternalToast. These wrappers set the correct values.
 */
import { toast as sonnerToast, type ExternalToast } from "sonner";

type ToastMessage = string | React.ReactNode;

function success(message: ToastMessage, options?: ExternalToast) {
  return sonnerToast.success(message, {
    ...options,
    role: "status",
    ariaLive: "polite",
  });
}

function error(message: ToastMessage, options?: ExternalToast) {
  return sonnerToast.error(message, {
    ...options,
    role: "alert",
    ariaLive: "assertive",
  });
}

function warning(message: ToastMessage, options?: ExternalToast) {
  return sonnerToast.warning(message, {
    ...options,
    role: "alert",
    ariaLive: "assertive",
  });
}

function info(message: ToastMessage, options?: ExternalToast) {
  return sonnerToast.info(message, {
    ...options,
    role: "status",
    ariaLive: "polite",
  });
}

function loading(message: ToastMessage, options?: ExternalToast) {
  return sonnerToast.loading(message, {
    ...options,
    role: "status",
    ariaLive: "polite",
  });
}

/** Drop-in replacement for sonner's toast with accessible defaults */
export const accessibleToast = Object.assign(
  (message: ToastMessage, options?: ExternalToast) =>
    sonnerToast(message, { ...options, role: "status", ariaLive: "polite" }),
  { success, error, warning, info, loading, dismiss: sonnerToast.dismiss, promise: sonnerToast.promise }
);
