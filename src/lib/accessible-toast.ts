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
type AccessibleToastOptions = ExternalToast & { role?: string; ariaLive?: string };

function success(message: ToastMessage, options?: AccessibleToastOptions) {
  return sonnerToast.success(message, {
    ...options,
    role: "status",
    ariaLive: "polite",
  } as ExternalToast);
}

function error(message: ToastMessage, options?: AccessibleToastOptions) {
  return sonnerToast.error(message, {
    ...options,
    role: "alert",
    ariaLive: "assertive",
  } as ExternalToast);
}

function warning(message: ToastMessage, options?: AccessibleToastOptions) {
  return sonnerToast.warning(message, {
    ...options,
    role: "alert",
    ariaLive: "assertive",
  } as ExternalToast);
}

function info(message: ToastMessage, options?: AccessibleToastOptions) {
  return sonnerToast.info(message, {
    ...options,
    role: "status",
    ariaLive: "polite",
  } as ExternalToast);
}

function loading(message: ToastMessage, options?: AccessibleToastOptions) {
  return sonnerToast.loading(message, {
    ...options,
    role: "status",
    ariaLive: "polite",
  } as ExternalToast);
}

/** Drop-in replacement for sonner's toast with accessible defaults */
export const accessibleToast = Object.assign(
  (message: ToastMessage, options?: AccessibleToastOptions) =>
    sonnerToast(message, { ...options, role: "status", ariaLive: "polite" } as ExternalToast),
  { success, error, warning, info, loading, dismiss: sonnerToast.dismiss, promise: sonnerToast.promise }
);
