declare module "@mixmark-io/domino" {
  type Domino = {
    createWindow(html?: string, address?: string): Window & typeof globalThis;
  };

  const domino: Domino;
  export default domino;
}
