import { useEffect } from 'react';
import { socket } from '../socket';
import { useApp } from '../context/AppContext';

export const useSocket = () => {
    const { role, refreshData, token } = useApp();

    useEffect(() => {
        if (!token) return;

        socket.auth = { token };
        socket.connect();

        socket.on('request:new', (data) => {
            console.log('Socket event: request:new', data);
            refreshData();
        });

        socket.on('new:pickup:request', (data) => {
            console.log('Socket event: new:pickup:request', data);
            refreshData();
        });

        socket.on('request:updated', (data) => {
            console.log('Socket event: request:updated', data);
            refreshData();
        });

        socket.on('locker:ready', (data) => {
            console.log('Socket event: locker:ready', data);
            if (role === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('locker:ready:received', { detail: data }));
                refreshData();
            }
        });

        socket.on('notification:new', (data) => {
            console.log('Socket event: notification:new', data);
            if (role === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('notification:new:received', { detail: data }));
            }
        });

        socket.on('driver:location', (data) => {
            if (role === 'CLIENT') {
                window.dispatchEvent(new CustomEvent('driver:location:received', { detail: data }));
            }
        });

        return () => {
            socket.off('request:new');
            socket.off('new:pickup:request');
            socket.off('request:updated');
            socket.off('locker:ready');
            socket.off('notification:new');
            socket.off('driver:location');
            socket.disconnect();
        };
    }, [token, role, refreshData]);

    // Expose socket instance for specialized hooks
    return { socket };
};
