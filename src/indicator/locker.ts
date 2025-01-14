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
            this.unlock();
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

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
