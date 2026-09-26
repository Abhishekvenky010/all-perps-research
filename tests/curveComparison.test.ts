import { describe, it } from "vitest";


function linear(
  s:number,
  k:number
){
  return k*s;
}


function quadratic(
  s:number,
  k:number
){
  return k*s*s;
}


function cubic(
  s:number,
  k:number
){
  return k*s*s*s;
}


function capacityBarrier(
  s:number,
  k:number
){
  return k*(s/(1-s));
}


describe("Curve comparison",()=>{

  it("compares skew curves",()=>{

    const skews=[
      0.1,
      0.5,
      0.9,
      0.99
    ];

    const k=0.2;


    for(const s of skews){

      console.log(
        "\nSkew:",
        s,
        {
          linear:
            linear(s,k),

          quadratic:
            quadratic(s,k),

          cubic:
            cubic(s,k),

          capacity:
            capacityBarrier(s,k)
        }
      );

    }

  });

});