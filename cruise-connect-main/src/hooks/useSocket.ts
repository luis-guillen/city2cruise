import { useEffect, useState, useRef, useCallback } from 'react';
import { socket } from '../socket';
import { useApp } from '../context/AppContext';
import { logger } from '@/utils/logger';

export const useSocket = () => {
    const { role, refreshData, token } = useApp();
    const [isConnected, setIsConnected] = useState(socket.connected);

    // Use refs so the effect closure always sees the latest values
    // without needing them in the dependency array (which would cause reconnect loops).
    const refreshDataRef = useRef(refreshData);
    refreshDataRef.current = refreshData;
    const roleRef = useRef(role);
    roleRef.current = role;

    useEffect(() => {
        if (!token) return;

        const onConnect = () => {
            setIsConnected(true);
            void Promise.resolve(refreshDataRef.current()).catch((err) => {
                logger.debug('Socket connect refresh failed', err);
            });
        };
        const onDisconnect = () => setIsConnected(false);

        const onRequestNew = (data: unknown) => {
            logger.debug('Socket event: request:new', data);
            refreshDataRef.current();
        };
        const onNewPickupRequest = (data: unknown) => {
            logger.debug('Socket event: new:pickup:request', data);
            refreshDataRef.current();
        };
        const onRequestUpdated = (data: unknown) => {
            logger.debug('Socket event: request:updated', data);
            refreshDataRef.current();
        };
        const onLockerReady = (data: unknown) => {
            logger.debug('Socket event: locker:ready', data);
            if (roleRef.current === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('locker:ready:received', { detail: data }));
                refreshDataRef.current();
            }
        };
        const onNotificationNew = (data: unknown) => {
            logger.debug('Socket event: notification:new', data);
            if (roleRef.current === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('notification:new:received', { detail: data }));
            }
        };
        const onDriverLocation = (data: unknown) => {
            if (roleRef.current === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('driver:location:received', { detail: data }));
            }
        };
        const onDriverRoute = (data: unknown) => {
            if (roleRef.current === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('driver:route:received', { detail: data }));
            }
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('request:new', onRequestNew);
        socket.on('new:pickup:request', onNewPickupRequest);
        socket.on('request:updated', onRequestUpdated);
        socket.on('locker:ready', onLockerReady);
        socket.on('notification:new', onNotificationNew);
        socket.on('driver:location', onDriverLocation);
        socket.on('driver:route', onDriverRoute);

        socket.auth = { token };
        if (!socket.connected) {
            socket.connect();
        }

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('request:new', onRequestNew);
            socket.off('new:pickup:request', onNewPickupRequest);
            socket.off('request:updated', onRequestUpdated);
            socket.off('locker:ready', onLockerReady);
            socket.off('notification:new', onNotificationNew);
            socket.off('driver:location', onDriverLocation);
            socket.off('driver:route', onDriverRoute);
            socket.disconnect();
        };
    }, [token]);

    // Expose socket instance and connection status
    return { socket, isConnected };
};
