export class Mutex {
    private isOn: boolean;
    constructor() {
        this.isOn = false;
    }

    async with(job: () => Promise<void>) {
        await this.lock();
        try {
            await job();
        } finally {
            this.unlock();
        }
    }

    async lock() {
        while (true) {
            if (!this.isOn) {
                break;
            }
            await sleep(500);
        }
        this.isOn = true;
    }


    async unlock() {
        this.isOn = false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
