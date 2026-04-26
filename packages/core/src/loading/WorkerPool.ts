import CompressedDecoderWorker from "./compressed-decoder.worker.ts?worker&inline";
import UncompressedDecoderWorker from "./uncompressed-decoder.worker.ts?worker&inline";

/**
 * Enumerates the types of workers available in the worker pool.
 */
export enum WorkerType {
  /**
   * Worker for decoding compressed octree node data.
   */
  COMPRESSED_DECODER_WORKER = "COMPRESSED_DECODER_WORKER",

  /**
   * Worker for decoding uncompressed octree node data.
   */
  UNCOMPRESSED_DECODER_WORKER = "UNCOMPRESSED_DECODER_WORKER",
}

/**
 * Creates a new worker instance based on the specified worker type.
 *
 * @param type - The type of worker to create.
 * @returns A new instance of a Worker that corresponds to the specified worker type.
 * @throws {Error} If an unknown worker type is provided.
 */
function createWorker(type: WorkerType): Worker {
  switch (type) {
    case WorkerType.COMPRESSED_DECODER_WORKER: {
      return new CompressedDecoderWorker();
    }
    case WorkerType.UNCOMPRESSED_DECODER_WORKER: {
      return new UncompressedDecoderWorker();
    }
    default:
      throw new Error("Unknown worker type");
  }
}

/**
 * WorkerPool manages a collection of worker instances, allowing for efficient retrieval and return of workers based on their type.
 */
export class WorkerPool {
  private disposed = false;

  private readonly allWorkers = new Set<Worker>();

  /**
   * Workers will be an object that has a key for each worker type and the value is an array of Workers that can be empty.
   */
  public workers: { [key in WorkerType]: Worker[] } = {
    COMPRESSED_DECODER_WORKER: [],
    UNCOMPRESSED_DECODER_WORKER: [],
  };

  /**
   * Retrieves a Worker instance from the pool associated with the specified worker type.
   *
   * If no worker instances are available, a new worker is created and added to the pool before retrieving one.
   *
   * @param workerType - The type of the worker to retrieve.
   * @returns A Worker instance corresponding to the specified worker type.
   * @throws Error if the worker type is not recognized or if no workers are available in the pool.
   */
  public getWorker(workerType: WorkerType): Worker {
    if (this.disposed) {
      throw new Error("Worker pool has been disposed");
    }

    // Throw error if workerType is not recognized
    if (this.workers[workerType] === undefined) {
      throw new Error("Unknown worker type");
    }
    // Given a worker URL, if URL does not exist in the worker object, create a new array with the URL as a key
    if (this.workers[workerType].length === 0) {
      const worker = createWorker(workerType);
      this.allWorkers.add(worker);
      this.workers[workerType].push(worker);
    }
    const worker = this.workers[workerType].pop();
    if (worker === undefined) {
      // Typescript needs this
      throw new Error("No workers available");
    }
    // Return the last worker in the array and remove it from the array
    return worker;
  }

  /**
   * Returns a worker instance to the pool for the specified worker type.
   *
   * @param workerType - The type of the worker, which determines the corresponding pool.
   * @param worker - The worker instance to be returned to the pool.
   */
  public returnWorker(workerType: WorkerType, worker: Worker) {
    if (this.disposed) {
      this.allWorkers.delete(worker);
      worker.terminate();
      return;
    }

    this.workers[workerType].push(worker);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    for (const worker of this.allWorkers) {
      worker.terminate();
    }

    this.allWorkers.clear();

    for (const workerType of Object.values(WorkerType)) {
      this.workers[workerType] = [];
    }
  }
}
