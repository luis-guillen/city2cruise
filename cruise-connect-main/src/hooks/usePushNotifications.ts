import { useState, useCallback } from 'react';
import { getVapidPublicKey, registerPushSubscription, unregisterPushSubscription } from '@/services/api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export function usePushNotifications() {
  const [permissionState, setPermissionState] = useState<PermissionState>(() => {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission as PermissionState;
  });
  const [isSubscribing, setIsSubscribing] = useState(false);

  const isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;
    setIsSubscribing(true);
    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission as PermissionState);
      if (permission !== 'granted') return false;

      const registration = await navigator.serviceWorker.ready;
      const publicKey = await getVapidPublicKey();

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await registerPushSubscription(sub.toJSON() as PushSubscriptionJSON);
      return true;
    } catch (err) {
      console.error('[Push] subscribe error:', err);
      return false;
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!isSupported) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (!sub) return;
      await unregisterPushSubscription(sub.endpoint);
      await sub.unsubscribe();
      setPermissionState('default');
    } catch (err) {
      console.error('[Push] unsubscribe error:', err);
    }
  }, [isSupported]);

  // Call on login to silently re-register existing subscription
  const syncSubscription = useCallback(async (): Promise<void> => {
    if (!isSupported || Notification.permission !== 'granted') return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await registerPushSubscription(sub.toJSON() as PushSubscriptionJSON);
      }
    } catch {
      // Non-critical — ignore
    }
  }, [isSupported]);

  return { isSupported, permissionState, isSubscribing, subscribe, unsubscribe, syncSubscription };
}
