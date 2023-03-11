import * as AsyncLock from "async-lock";

const locker = new AsyncLock({
    maxPending: Number.POSITIVE_INFINITY,
});

export default locker;
