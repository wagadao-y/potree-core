export class BinaryHeap<T> {
  public content: T[] = [];

  public constructor(public scoreFunction: (node: T) => number) {}

  public push(element: T): void {
    this.content.push(element);
    this.bubbleUp(this.content.length - 1);
  }

  public pop(): T | undefined {
    const result = this.content[0];
    const end = this.content.pop();

    if (end !== undefined && this.content.length > 0) {
      this.content[0] = end;
      this.sinkDown(0);
    }

    return result;
  }

  public remove(node: T): void {
    const length = this.content.length;

    for (let index = 0; index < length; index++) {
      if (this.content[index] !== node) {
        continue;
      }

      const end = this.content.pop();
      if (end === undefined || index === length - 1) {
        break;
      }

      this.content[index] = end;
      this.bubbleUp(index);
      this.sinkDown(index);
      break;
    }
  }

  public size(): number {
    return this.content.length;
  }

  public bubbleUp(index: number): void {
    const element = this.content[index];
    const score = this.scoreFunction(element);

    while (index > 0) {
      const parentIndex = Math.floor((index + 1) / 2) - 1;
      const parent = this.content[parentIndex];
      if (score >= this.scoreFunction(parent)) {
        break;
      }

      this.content[parentIndex] = element;
      this.content[index] = parent;
      index = parentIndex;
    }
  }

  public sinkDown(index: number): void {
    const length = this.content.length;
    const element = this.content[index];
    const elementScore = this.scoreFunction(element);

    while (true) {
      const child2Index = (index + 1) * 2;
      const child1Index = child2Index - 1;
      let swapIndex: number | null = null;
      let child1Score = elementScore;

      if (child1Index < length) {
        const child1 = this.content[child1Index];
        child1Score = this.scoreFunction(child1);
        if (child1Score < elementScore) {
          swapIndex = child1Index;
        }
      }

      if (child2Index < length) {
        const child2 = this.content[child2Index];
        const child2Score = this.scoreFunction(child2);
        if (child2Score < (swapIndex === null ? elementScore : child1Score)) {
          swapIndex = child2Index;
        }
      }

      if (swapIndex === null) {
        break;
      }

      this.content[index] = this.content[swapIndex];
      this.content[swapIndex] = element;
      index = swapIndex;
    }
  }
}
