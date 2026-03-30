import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export interface JwtPayload {
    id: number;
    name: string;
    role: 'CLIENT' | 'DRIVER' | 'ADMIN';
}

export const generateToken = (payload: JwtPayload): string => {
    return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn: '24h' });
};

export const verifyToken = (token: string): JwtPayload | null => {
    try {
        return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
    } catch (err) {
        return null;
    }
};
