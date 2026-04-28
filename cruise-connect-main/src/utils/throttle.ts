/**
 * Hito 4.2.2 — Throttle simple compatible con SSR/jsdom.
 *
 * Devuelve una funcion que solo invoca `fn` como mucho una vez cada
 * `wait` ms. Las llamadas intermedias se descartan, conservando el
 * ultimo argumento para una posible llamada de "trailing".
 */
export function throttle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  wait: number
): ((...args: TArgs) => void) & { cancel: () => void } {
  let lastCall = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: TArgs | null = null;

  const throttled = (...args: TArgs) => {
    const now = Date.now();
    const remaining = wait - (now - lastCall);
    if (remaining <= 0) {
      lastCall = now;
      pendingArgs = null;
      if (trailingTimer) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
      fn(...args);
    } else {
      pendingArgs = args;
      if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          lastCall = Date.now();
          trailingTimer = null;
          if (pendingArgs) {
            const a = pendingArgs;
            pendingArgs = null;
            fn(...a);
          }
        }, remaining);
      }
    }
  };

  throttled.cancel = () => {
    if (trailingTimer) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
    pendingArgs = null;
  };

  return throttled;
}
