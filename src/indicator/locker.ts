/**
 * A simple mutex locker.
 * 
 * Provide usage in "lock/unlock" style and "with" style.
 */
export class Mutex {
    private isOn: boolean;
    constructor(private backoffMs: number = 500) {
        this.isOn = false;
    }

    /** with blocking wait the lock before run job, and unlock before return. */
    async with(job: () => Promise<void>) {
        await this.lock();
        try {
            await job();
        } finally {
            // unlock in "finally" to ensure cleanup for potential exception.
            await this.unlock();
        }
    }

    /** lock the mutex, block until the mutex is unlocked. */
    async lock() {
        // just check the value, since that JS runtime is single thread.
        while (true) {
            if (!this.isOn) {
                break;
            }
            await sleep(this.backoffMs);
        }
        this.isOn = true;
    }

    /** unlock the mutex, allow other to lock. */
    async unlock() {
        this.isOn = false;
    }
}

/** 
 * Ticket is a abstraction of cancellation signal into promise. 
 * 
 * Inspired by Context from golang, used for main loop synchronization.
 */
export class Ticket {
    public isExpired = false;
    private promise: Promise<void>;

    constructor(
        private signal: AbortSignal,
    ) {
        // AbortSignal inherit from EventTarget and can use 'abort' event
        // https://nodejs.org/api/globals.html#class-abortsignal
        // https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal

        this.promise = new Promise((resolve) => {

            // @ts-ignore
            this.signal.addEventListener('abort', resolve);
        });

        // @ts-ignore
        this.signal.addEventListener('abort', () => {
            this.isExpired = true;
        });
    }

    /** Return the static promise for this ticket, only resolved when expired. */
    done(): Promise<void> {
        return this.promise;
    }
}

/** A Daemon that run main loop periodically with expire-ticket check. */
export class Daemon {
    constructor(
        public intervalSec: number
    ) {
    }

    updateInterval(sec: number): void {
        this.intervalSec = sec;
    }

    /** Run the given job repetitively until the ticket is expired. */
    async run(ticket: Ticket, main: () => Promise<void>): Promise<void> {
        while (await wait(ticket, 1000 * this.intervalSec)) {
            await main();
        }
    }
}

/** Wait until ms is passed or ticket expired, return false if ticket expired */
export async function wait(ticket: Ticket, ms: number): Promise<boolean> {
    const segment = Math.min(ms / 10, 100);
    const total = Math.ceil(ms / segment);

    // Wrap AbortSignal into ticket promise and block on two event source.
    // Once AbortSignal.any is available, this encapsulation is not required.

    let count = 0;
    while (!ticket.isExpired && count < total) {
        await Promise.any([sleep(segment), ticket.done()]);
        count += 1;
    }
    return !ticket.isExpired;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
