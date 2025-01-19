import * as assert from 'assert';

import * as locker from './locker';

describe('locker', () => {

    const sleep = (ms: number): Promise<void> => {
        return new Promise(resolve => setTimeout(resolve, ms));
    };

    describe('Mutex', () => {
        it('should provide exclusive execution', async () => {
            const mutex = new locker.Mutex(0);

            let counter = 0;
            const buildJob = (n: number) => {
                return mutex.with(async () => {
                    const next = counter + 1;
                    await sleep(0); // provide a chance to switch context.
                    counter = next;
                });
            };
            const jobCount = 32;
            const jobs = [...Array(jobCount).keys()].map(buildJob);

            await Promise.all(jobs);

            assert.strictEqual(counter, jobCount);
        });
    });

    describe('Ticket', () => {
        it('should provide a promise that only resolve when controller aborted', async () => {
            const controller = new AbortController();
            const ticket = new locker.Ticket(controller.signal);

            assert.strictEqual(ticket.isExpired, false);

            controller.abort();

            await ticket.done(); // will not block here.
            assert.strictEqual(ticket.isExpired, true);
        });
    });
});
