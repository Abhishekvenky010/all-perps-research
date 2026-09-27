import type {
  Position,
} from "./Position.js";


export class PositionManager {

  private positions:
    Map<string, Position>;


  constructor() {

    this.positions =
      new Map();

  }


  openPosition(
    position: Position,
  ): void {

    this.positions.set(
      position.id,
      position,
    );

  }
  
    getPosition(
    id: string,
  ): Position | undefined {

    return this.positions.get(id);

  }

  getPositionsByTrader(
    trader: string
  ): Position[] {

    return Array.from(
      this.positions.values()
    ).filter(
      position =>
        position.trader === trader
    );

  }


  closePosition(
    id: string,
  ): Position | undefined {

    const position =
      this.positions.get(id);


    if (!position) {
      return undefined;
    }


    this.positions.delete(id);


    return position;

  }


  getAllPositions(): Position[] {

    return Array.from(
      this.positions.values(),
    );

  }

}