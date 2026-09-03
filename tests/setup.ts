// pdf.js 5 evaluates DOMMatrix support at module load. jsdom does not expose
// it yet, while every supported Electron runtime does.
if (globalThis.DOMMatrix === undefined) {
  class TestDOMMatrix {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0
  }
  Object.assign(globalThis, { DOMMatrix: TestDOMMatrix })
}
