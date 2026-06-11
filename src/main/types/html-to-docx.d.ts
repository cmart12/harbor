declare module 'html-to-docx' {
  interface DocumentMargins {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
    header?: number;
    footer?: number;
    gutter?: number;
  }

  interface DocumentOptions {
    title?: string;
    subject?: string;
    creator?: string;
    orientation?: 'portrait' | 'landscape';
    margins?: DocumentMargins;
    pageNumber?: boolean;
    font?: string;
    fontSize?: number;
    header?: boolean;
    footer?: boolean;
    table?: { row?: { cantSplit?: boolean } };
    [key: string]: unknown;
  }

  /**
   * Converts an HTML string into a Word (.docx) document.
   * In Node it resolves to a Buffer; in the browser to a Blob/ArrayBuffer.
   */
  function HTMLtoDOCX(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: DocumentOptions,
    footerHTMLString?: string | null,
  ): Promise<Buffer | ArrayBuffer | Blob>;

  export = HTMLtoDOCX;
}
