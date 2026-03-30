import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/errors';
import { verifyToken, JwtPayload } from './jwt';

declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}

/**
 * Middleware para autenticación JWT
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Falta token de autorización o es inválido');
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    if (!decoded) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Token expirado o inválido');
    }

    req.user = decoded;
    next();
};

/**
 * Middleware para autorización estricta por roles
 */
export const requireRole = (role: 'CLIENT' | 'DRIVER' | 'ADMIN') => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user || req.user.role !== role) {
            return sendError(res, 403, 'FORBIDDEN', `Acceso denegado: se requiere rol ${role}`);
        }
        next();
    };
};
