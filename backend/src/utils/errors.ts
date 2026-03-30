import { Request, Response, NextFunction } from 'express';
import { ErrorResponse } from '../types/dto';
import { logger } from './logger';

/**
 * Error lanzado por la capa de servicios con código HTTP, código de negocio
 * y datos extra opcionales (ej. distance_meters en GPS_PROXIMITY_FAILED).
 */
export class ServiceError extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly extra?: Record<string, unknown>;

    constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
        super(message);
        this.name = 'ServiceError';
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

/**
 * Standardized error response sender
 */
export const sendError = (
    res: Response,
    statusCode: number,
    code: string,
    message: string
) => {
    const errorResponse: ErrorResponse = {
        error: {
            code,
            message,
        },
    };
    res.status(statusCode).json(errorResponse);
};

/**
 * Global Express Error Handler Middleware
 */
export const globalErrorHandler = (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'A fatal error occurred on the server.');
};
