import { useEffect, useState } from 'react';
import { socket } from '../socket';
import { useApp } from '../context/AppContext';
import { logger } from '@/utils/logger';

export const useSocket = () => {
    const { role, refreshData, token } = useApp();
    const [isConnected, setIsConnected] = useState(socket.connected);

    useEffect(() => {
        if (!token) return;

        const onConnect = () => setIsConnected(true);
        const onDisconnect = () => setIsConnected(false);

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);

        socket.auth = { token };
        socket.connect();

        socket.on('request:new', (data) => {
            logger.debug('Socket event: request:new', data);
            refreshData();
        });

        socket.on('new:pickup:request', (data) => {
            logger.debug('Socket event: new:pickup:request', data);
            refreshData();
        });

        socket.on('request:updated', (data) => {
            logger.debug('Socket event: request:updated', data);
            refreshData();
        });

        socket.on('locker:ready', (data) => {
            logger.debug('Socket event: locker:ready', data);
            if (role === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('locker:ready:received', { detail: data }));
                refreshData();
            }
        });

        socket.on('notification:new', (data) => {
            logger.debug('Socket event: notification:new', data);
            if (role === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('notification:new:received', { detail: data }));
            }
        });

        socket.on('driver:location', (data) => {
            if (role === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('driver:location:received', { detail: data }));
            }
        });

        socket.on('driver:route', (data) => {
            if (role === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('driver:route:received', { detail: data }));
            }
        });

        socket.on('connect', () => {
            void Promise.resolve(refreshData()).catch((err) => {
                logger.debug('Socket connect refresh failed', err);
            });
        });

        return () => {
            socket.off('connect');
            socket.off('request:new');
            socket.off('new:pickup:request');
            socket.off('request:updated');
            socket.off('locker:ready');
            socket.off('notification:new');
            socket.off('driver:location');
            socket.off('driver:route');
            socket.disconnect();
        };
    }, [token, role, refreshData]);

    // Expose socket instance and connection status
    return { socket, isConnected };
};
