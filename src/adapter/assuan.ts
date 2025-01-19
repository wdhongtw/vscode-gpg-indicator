import * as net from 'net';
import * as fs from 'fs';
import { promisify } from 'util';

class RequestCommand {
    command: string;
    parameters: string | undefined = undefined;

    constructor(command: string, parameters?: string) {
        this.command = command;
        this.parameters = parameters;
    }
}

class RequestRawData {
    bytes: Buffer;

    constructor(bytes: Buffer) {
        this.bytes = bytes;
    }
}

enum RequestType {
    command = "",
    rawData = "D",
}

/**
 * The Request object for the Assuan protocol.
 *
 * @see {@link https://www.gnupg.org/documentation/manuals/assuan/Client-requests.html#Client-requests}
 */
class Request {
    #bytes: Buffer = Buffer.from([]);

    static fromCommand(command: RequestCommand): Request {
        const request = new Request;
        if (command.parameters) {
            request.#bytes = Buffer.from(`${command.command} ${command.parameters}`, 'utf8');
        } else {
            request.#bytes = Buffer.from(command.command, 'utf8');
        }

        return request;
    }

    static fromRawData(rawData: RequestRawData): Request {
        const request = new Request;
        const encoded = Buffer.from(encodeURI(rawData.bytes.toString('utf8')), 'utf8');
        request.#bytes = Buffer.concat([Buffer.from('D ', 'utf8'), encoded]);

        return request;
    }

    toBytes(): Buffer {
        return this.#bytes;
    }
}

class ResponseOk {
    message: string | undefined;

    constructor(message?: string) {
        this.message = message;
    }
}

class ResponseError {
    code: number;
    description: string | undefined;

    constructor(code: number, description?: string) {
        this.code = code;
        this.description = description;
    }
}


class ResponseRawData {
    bytes: Buffer;

    constructor(bytes: Buffer) {
        this.bytes = bytes;
    }
}


class ResponseInformation {
    keyword: string;
    information: string;

    constructor(keyword: string, information: string) {
        this.keyword = keyword;
        this.information = information;
    }
}

class ResponseComment {
    comment: string;

    constructor(comment: string) {
        this.comment = comment;
    }
}

class ResponseInquire {
    keyword: string;
    parameters: string;

    constructor(keyword: string, parameters: string) {
        this.keyword = keyword;
        this.parameters = parameters;
    }
}

enum ResponseType {
    ok = "OK",
    error = "ERR",
    information = "S",
    comment = "#",
    rawData = "D",
    inquire = "INQUIRE",
}

/**
 * The Response object for the Assuan protocol.
 *
 * @see {@link https://www.gnupg.org/documentation/manuals/assuan/Server-responses.html#Server-responses}
 */
class Response {
    #bytes: Buffer = Buffer.from([]);

    static fromBytes(bytes: Buffer): Response {
        const response = new Response();
        response.#bytes = bytes;
        return response;
    }

    getType(): ResponseType {
        const types = [
            ResponseType.ok,
            ResponseType.error,
            ResponseType.information,
            ResponseType.comment,
            ResponseType.rawData,
            ResponseType.inquire,
        ];
        for (const type of types) {
            if (this.#bytes.indexOf(type, 0, 'utf8') !== 0) {
                continue;
            }
            return type;
        }
        throw new Error("Unknown server response type");
    }

    checkType(type: ResponseType): void {
        if (this.getType() !== type) {
            throw new Error("The response is not of given type");
        }
    }

    toOk(): ResponseOk {
        this.checkType(ResponseType.ok);

        if (this.#bytes.length === 2) {
            return new ResponseOk();
        }
        return new ResponseOk(this.#bytes.subarray(3).toString('utf8'));
    }

    toError(): ResponseError {
        this.checkType(ResponseType.error);

        const regex = /^ERR\s(?<code>\d+)(?:\s(?<description>.*))?$/;
        const payload = this.#bytes.toString('utf8');
        const match = regex.exec(payload);
        if (!match || !match.groups) {
            throw new Error("fail to parse error response");
        }
        return new ResponseError(parseInt(match.groups["code"], 10), match.groups["description"]);
    }

    toRawData(): ResponseRawData {
        this.checkType(ResponseType.rawData);

        const decoded = Buffer.from(decodeURI(this.#bytes.subarray(2).toString('utf8')), 'utf8');
        return new ResponseRawData(decoded);
    }

    toInformation(): ResponseInformation {
        this.checkType(ResponseType.information);

        const regex = /^S\s(?<keyword>\w+)\s(?<information>.*)$/;
        const payload = this.#bytes.toString('utf8');
        const match = regex.exec(payload);
        if (!match || !match.groups) {
            throw new Error("fail to parse information response");
        }
        return new ResponseInformation(match.groups["keyword"], match.groups["information"]);
    }

    toComment(): ResponseComment {
        this.checkType(ResponseType.comment);

        return new ResponseComment(this.#bytes.subarray(2).toString('utf-8'));
    }

    toInquire(): ResponseInquire {
        this.checkType(ResponseType.inquire);

        const regex = /^S\s(?<keyword>\w+)\s(?<parameters>.*)$/;
        const payload = this.#bytes.toString('utf8');
        const match = regex.exec(payload);
        if (!match || !match.groups) {
            throw new Error("fail to parse inquire response");
        }
        return new ResponseInquire(match.groups["keyword"], match.groups["parameters"]);
    }
}

function splitLines(data: Buffer): Array<Buffer> {
    const result: Buffer[] = [];
    while (data.length > 0) {
        const index = data.indexOf('\n', 0, 'utf8');
        if (index === -1) {
            throw new Error("the input data is contains no \\n character");
        }
        result.push(data.subarray(0, index));
        data = data.subarray(index + 1, data.length);
    }
    return result;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export interface TcpInfo {
    port: number;
    sharedKey: Buffer;
}

/**
 * Detect the TCP connection information from the file, if any.
 *
 * @param configPath - The file path to the GnuPG socket.
 */
export async function detectTcpInfo(configPath: string): Promise<TcpInfo | undefined> {
    // In some platform, e.g. Gpg4win, the file is not a socket.
    // Instead, it's a regular file for storing the port and shared key.

    const lstat = promisify(fs.lstat);
    const status = await lstat(configPath);
    if (!status.isFile()) { return undefined; }

    // The file contains two parts, separated by a new line character.
    // First part is port in decimal string, second part is the shared key in raw bytes.
    const content = fs.readFileSync(configPath);
    const pos = content.indexOf('\n', 0, 'utf8');
    if (pos === -1) {
        throw new Error("the file is not in correct format");
    }

    return {
        port: parseInt(content.subarray(0, pos).toString('utf8'), 10),
        sharedKey: content.subarray(pos + 1, content.length),
    };
}

/**
 * Build a Assuan agent from the given socket path.
 *
 * @param socketPath - The file path to the GnuPG socket.
 */
export async function buildAgent(socketPath: string): Promise<Assuan> {
    const tcpInfo = await detectTcpInfo(socketPath);
    const socketOrTcp = tcpInfo === undefined ? socketPath : tcpInfo;
    return new AssuanClient(socketOrTcp);
}

/**
 * The Assuan interface for Assuan Protocol.
 */
interface Assuan {

    /** Wait for the underline connection to be established. */
    initialize(): Promise<void>;

    /** Close the underline connection. */
    dispose(): Promise<void>;

    /** Send a request to the server. */
    sendRequest(request: Request): Promise<void>;

    /** Receive a response from the server, blocking wait. */
    receiveResponse(): Promise<Response>;
}

/**
 * The AssuanClient class is a helper client for Assuan Protocol.
 */
class AssuanClient implements Assuan {
    #socket: net.Socket;

    #responseLines: Buffer[] = [];

    #socketErrorBuffer: Error[] = [];
    #isConnected = false;

    /**
     * Construct a client for Assuan Protocol
     *
     * @remarks User should wait initialize() to complete before sending any command.
     *
     * @param socketOrTcp - The file path to GnuPG unix socket, or the TCP connection information.
     */
    constructor(private socketOrTcp: string | TcpInfo) {

        const setConnected = () => { this.#isConnected = true; };
        this.#socket = typeof socketOrTcp === 'string'
            ? net.createConnection(socketOrTcp, setConnected)
            : net.createConnection(socketOrTcp.port, 'localhost', setConnected);

        this.#socket.on('data', (data: Buffer) => {
            const lines = splitLines(data);
            for (const line of lines) {
                this.#responseLines.push(line);
            }
        });

        this.#socket.on('error', (error: Error) => {
            this.#socketErrorBuffer.push(error);
        });
    }

    async initialize(): Promise<void> {
        while (true) {
            if (!this.#isConnected) {
                await sleep(0);
            }
            break;
        }

        if (typeof this.socketOrTcp === 'string') { return; }
        await this.handleSend(this.socketOrTcp.sharedKey);
    }

    async dispose(): Promise<void> {
        this.#socket.destroy();
    }

    async sendRequest(request: Request): Promise<void> {
        this.checkError();

        const line = request.toBytes();
        await this.handleSend(Buffer.concat([line, Buffer.from('\n', 'utf8')]));
    }

    private handleSend(payload: Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            this.#socket.write(payload, (err: Error | undefined) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Throws if encounter socket error or receive a error response.
     */
    private checkError(): void {
        const socketError = this.#socketErrorBuffer.shift();
        if (socketError) {
            throw socketError;
        }
    }

    async receiveResponse(): Promise<Response> {
        while (true) {
            this.checkError();

            const line = this.#responseLines.shift();
            if (!line) {
                await sleep(0);
                continue;
            }

            return Response.fromBytes(line);
        }
    }
}


export {
    AssuanClient,
    Request,
    RequestType,
    RequestCommand,
    RequestRawData,
    Response,
    ResponseType,
    ResponseOk,
    ResponseError,
    ResponseRawData,
};
