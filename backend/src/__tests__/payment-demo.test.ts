/**
 * Hito 6.x — Modo demo de pagos sin Stripe real.
 */
const dbMock = {
    query: jest.fn(),
    getClient: jest.fn(),
};

jest.mock('../db/database', () => ({
    db: dbMock,
}));

jest.mock('../config/env', () => ({
    config: {
        env: 'development',
        stripe: {
            secretKey: 'sk_test_demo',
            webhookSecret: '',
            currency: 'eur',
        },
        payments: {
            demoMode: true,
        },
    },
}));

jest.mock('../services/AuditService', () => ({
    logAuditEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

import { createPaymentIntent, confirmPaymentIntent, stripe } from '../services/PaymentService';

describe('Hito 6.x — payments demo mode', () => {
    beforeEach(() => {
        dbMock.query.mockReset();
        jest.restoreAllMocks();
    });

    it('createPaymentIntent devuelve un intent demo sin llamar a Stripe', async () => {
        const createSpy = jest.spyOn(stripe.paymentIntents, 'create').mockResolvedValue({
            id: 'pi_real',
            client_secret: 'cs_real',
        } as any);

        dbMock.query
            .mockResolvedValueOnce({ rows: [{ id: 6, status: 'REQUESTED', client_id: 1 }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: 42 }] });

        const result = await createPaymentIntent({
            requestId: 6,
            clientId: 1,
            packageSize: 'SMALL',
        });

        expect(result.demoMode).toBe(true);
        expect(result.paymentIntentId).toMatch(/^demo_pi_/);
        expect(result.clientSecret).toMatch(/^demo_demo_pi_/);
        expect(result.paymentId).toBe(42);
        expect(createSpy).not.toHaveBeenCalled();
    });

    it('confirmPaymentIntent autoriza un intent demo sin llamar a Stripe', async () => {
        const retrieveSpy = jest.spyOn(stripe.paymentIntents, 'retrieve').mockResolvedValue({
            id: 'pi_real',
            status: 'requires_capture',
        } as any);

        dbMock.query
            .mockResolvedValueOnce({
                rows: [{ id: 42, status: 'PENDING', stripe_payment_intent_id: 'demo_pi_abc123' }],
            })
            .mockResolvedValueOnce({ rows: [] });

        const result = await confirmPaymentIntent({
            requestId: 6,
            clientId: 1,
            paymentIntentId: 'demo_pi_abc123',
        });

        expect(result.status).toBe('AUTHORIZED');
        expect(retrieveSpy).not.toHaveBeenCalled();
    });
});
