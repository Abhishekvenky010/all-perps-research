let counter = 0;


export function generatePositionId(): string {

  counter++;

  return `position-${counter}`;

}