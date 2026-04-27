import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/env';

export interface JwtPayload {
    id: number;
    name: string;
    role: 'CLIENT' | 'DRIVER' | 'ADMIN';
}

export const generateAccessToken = (payload: JwtPayload): string => {
    return jwt.sign({ ...payload, jti: crypto.randomUUID() }, config.jwtSecret, {
        algorithm: 'HS256',
        expiresIn: config.accessTokenExpirySeconds,
    });
};

// Alias mantenido para compatibilidad con tests existentes
export const generateToken = generateAccessToken;

export const verifyToken = (token: string): JwtPayload | null => {
    try {
        return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
    } catch {
        return null;
    }
};
