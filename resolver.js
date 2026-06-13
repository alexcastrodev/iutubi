export class Resolver {
  type = 'unknown';

  matches() {
    return false;
  }

  async resolve() {
    throw new Error(`${this.constructor.name} não implementa resolve()`);
  }
}
