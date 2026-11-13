export interface Preview {
  id: string;
  start: string;
  end: string;
  broken: number;
}

export interface Linking {
  from: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  over: string | null;
}
