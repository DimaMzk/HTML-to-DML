import { Configuration, OpenAIApi } from "openai";
const prompt = require("prompt-sync")({ sigint: true });
import { readFile, writeFile, access, mkdir, readdir } from "fs/promises";
import { XMLParser } from "fast-xml-parser";
import * as xml2js from "xml2js";
import GPT3Tokenizer from "gpt3-tokenizer";
import { JSDOM } from "jsdom";
const path = require("path");

const createFolderIfNotExist = async (folderName: string): Promise<void> => {
  const folderExists = await access(folderName)
    .then(() => true)
    .catch(() => false);

  if (!folderExists) {
    await mkdir(folderName);
  }
};

enum RUN_TYPE {
  BLOCKIFY_TEST, // Only run blockify code
  GPT_TEST, // Only proccess first generated block
  DMLIFY_TEST, // Use MJML from previous run to test DML conversion
  FULL_RUN, // Run the full process
}

const runType: RUN_TYPE = RUN_TYPE.FULL_RUN;

// get API key from process.env
import "dotenv/config";

// https://platform.openai.com/account/api-keys
const API_KEY = process.env.API_KEY;

const configuration = new Configuration({
  apiKey: API_KEY,
});
const openai = new OpenAIApi(configuration);

async function generateText(prompt: string) {
  // calculate the number of tokens in the prompt
  // 1 token = 4 characters
  const tokenizer = new GPT3Tokenizer({ type: "gpt3" }); // or 'codex'

  const encoded: { bpe: number[]; text: string[] } = tokenizer.encode(prompt);
  const tokens = encoded.bpe.length;
  // calculate the number of tokens to generate
  // The Max number of tokens is technically 4000,
  const maxTokens: number = Math.floor(8000 - tokens);
  const completion = await openai.createChatCompletion({
    model: "gpt-4",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.6,
    max_tokens: maxTokens,
  });
  if (completion.status < 200 || completion.status > 299) {
    console.log(`Error: " + completion.status + " - " + completion.statusText`);
    return `Error: ${completion.status} - ${completion.statusText}`;
  }
  return completion.data.choices[0].message.content;
}

async function convertToMJML(html: string) {
  const prompt = `Convert the following portion of this HTML Email to MJML, avoid using mj-table where possible, except for images that should be side by side. If using <br> tags, ensure that they are self closing e.g. <br />.If content looks like a footer: social media icons should use mj-social: \n ${html}`;
  const MJML = await generateText(prompt);
  return MJML;
}

// Traverse the HTML structure, and break it into chunks that are less than the max token size
//    this is a very lossy process, and relies on GPT inferring any missing tags
//    though, most of what will be lost are the very verbose table/outlook tags that aren't really
//    that important for inferring content
const autoBlockify = (html: string, maxTokenSize: number) => {
  const tokenizer = new GPT3Tokenizer({ type: "gpt3" }); // or 'codex'

  const chunks: string[] = [];

  function traverse(node: Element): void {
    const encoded: { bpe: number[]; text: string[] } = tokenizer.encode(
      node.innerHTML
    );
    const estTokens = encoded.bpe.length;
    if (estTokens <= maxTokenSize) {
      chunks.push(node.outerHTML);
      return;
    }

    for (const child of Array.from(node.children)) {
      const encoded: { bpe: number[]; text: string[] } = tokenizer.encode(
        child.outerHTML
      );
      const estTokens = encoded.bpe.length;
      if (estTokens <= maxTokenSize) {
        chunks.push(child.outerHTML);
        child.remove();
      } else {
        traverse(child);
      }
    }
  }

  const dom = new JSDOM(html);
  const root = dom.window.document.body;
  traverse(root);

  return chunks;
};

const tagMappings: { [key: string]: string | null } = {
  mjml: "dys-block",
  "mj-body": null,
  "mj-section": "dys-row",
  "mj-column": "dys-column",
  "mj-button": "dys-button",
  "mj-image": "dys-img",
  "mj-text": "dys-text",
  "mj-wrapper": "dys-wrapper",
  "mj-social": "dys-social",
  "mj-social-element": "dys-social-element",
  "mj-style": "dys-style",
  "mj-divider": "dys-divider",
  "mj-title": "dys-title",
  "mj-spacer": "dys-spacer",
  "mj-table": "dys-table",
  "mj-group": "dys-group",
  "mj-hero": "dys-hero",
  "mj-carousel": "dys-carousel",
  "mj-carousel-image": "dys-carousel-image",
  "mj-navbar": null,
  "mj-navbar-link": null,
  "mj-attributes": null,
  "mj-font": null,
  "mj-accordion": null,
  "mj-accordion-title": null,
  "mj-raw": "dys-html",
};

const attributeMappings: { [key: string]: { [key: string]: string | null } } = {
  "dys-block": {
    // dys-block has no attributes
  },
  "dys-wrapper": {
    "background-color": "background-color",
    "background-position": "background-position",
    "background-position-x": "background-position-x",
    "background-position-y": "background-position-y",
    "background-repeat": "background-repeat",
    "background-size": "background-size",
    "background-url": "background-url",
    border: "border",
    "border-bottom": "border-bottom",
    "border-left": "border-left",
    "border-radius": null, // Not supported by DML
    "border-right": "border-right",
    "border-top": "border-top",
    "css-class": "css-class",
    "full-width": "full-width",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    "text-align": "text-align",
  },
  "dys-row": {
    "background-color": "background-color",
    "background-position": "background-position",
    "background-position-x": "background-position-x",
    "background-position-y": "background-position-y",
    "background-repeat": "background-repeat",
    "background-size": "background-size",
    "background-url": "background-url",
    border: "border",
    "border-bottom": "border-bottom",
    "border-left": "border-left",
    "border-radius": "border-radius",
    "border-right": "border-right",
    "border-top": "border-top",
    "css-class": "css-class",
    direction: "direction",
    "full-width": "full-width",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    "text-align": "text-align",
  },
  "dys-column": {
    "background-color": "background-color",
    "inner-background-color": "inner-background-color",
    border: "border",
    "border-bottom": "border-bottom",
    "border-left": "border-left",
    "border-right": "border-right",
    "border-top": "border-top",
    "border-radius": "border-radius",
    "inner-border": "inner-border",
    "inner-border-bottom": "inner-border-bottom",
    "inner-border-left": "inner-border-left",
    "inner-border-right": "inner-border-right",
    "inner-border-top": "inner-border-top",
    "inner-border-radius": "inner-border-radius",
    width: "width",
    "vertical-align": "vertical-align",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    "css-class": "css-class",
  },
  "dys-text": {
    color: "color",
    "font-family": "font-family",
    "font-size": "font-size",
    "font-style": "font-style",
    "font-weight": "font-weight",
    "line-height": "line-height",
    "letter-spacing": "letter-spacing",
    height: "height",
    "text-decoration": "text-decoration",
    "text-transform": "text-transform",
    align: "align",
    "container-background-color": "container-background-color",
    padding: "padding",
    "padding-top": "padding-top",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "css-class": "css-class",
  },
  "dys-title": {
    // apparently mj-title has no attributes
    // ?????????
  },
  "dys-img": {
    align: "align",
    alt: "alt",
    border: "border",
    "border-top": null, // Not supported by DML
    "border-bottom": null, // Not supported by DML
    "border-left": null, // Not supported by DML
    "border-right": null, // Not supported by DML
    "border-radius": "border-radius",
    "container-background-color": "container-background-color",
    "css-class": "css-class",
    "fluid-on-mobile": "fluid-on-mobile",
    height: "height",
    href: "href",
    name: null, // Not supported by DML
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    rel: "rel",
    sizes: "sizes",
    src: "src",
    srcset: "srcset",
    target: "target",
    title: "title",
    usemap: null, // Not supported by DML
    width: "width",
  },
  "dys-button": {
    align: "align",
    "background-color": "background-color",
    border: "border",
    "border-bottom": "border-bottom",
    "border-left": "border-left",
    "border-radius": "border-radius",
    "border-right": "border-right",
    "border-top": "border-top",
    color: "color",
    "container-background-color": "container-background-color",
    "css-class": "css-class",
    "font-family": "font-family",
    "font-size": "font-size",
    "font-style": "font-style",
    "font-weight": "font-weight",
    height: "height",
    href: "href",
    "inner-padding": "inner-padding",
    "letter-spacing": "letter-spacing",
    "line-height": "line-height",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    rel: "rel",
    target: "target",
    "text-align": "text-align",
    "text-decoration": "text-decoration",
    "text-transform": "text-transform",
    title: null, // Not supported by DML
    "vertical-align": "vertical-align",
    width: "width",
  },
  "dys-table": {
    align: "align",
    border: null, // Not supported by DML (???)
    cellpadding: "cellpadding",
    cellspacing: "cellspacing",
    color: "color",
    "container-background-color": "container-background-color",
    "css-class": "css-class",
    "font-family": "font-family",
    "font-size": "font-size",
    "line-height": "line-height",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    role: null, // Not supported by DML
    "table-layout": "table-layout",
    width: "width",
  },
  "dys-group": {
    width: "width",
    "vertical-align": "vertical-align",
    "background-color": "background-color",
    direction: "direction",
    "css-class": "css-class",
  },
  "dys-hero": {
    "background-color": "background-color",
    "background-height": "background-height",
    "background-position": "background-position",
    "background-url": "background-url",
    "background-width": "background-width",
    "border-radius": "border-radius",
    height: "height",
    mode: "mode",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    "vertical-align": "vertical-align",
  },
  "dys-carousel": {
    align: "align",
    "container-background-color": "background-color",
    "border-radius": "border-radius",
    "css-class": "css-class",
    "icon-width": "icon-width",
    "left-icon": "left-icon",
    "right-icon": "right-icon",
    "tb-border": "tb-border",
    "tb-border-radius": "tb-border-radius",
    "tb-border-color": "tb-border-color",
    "tb-selected-border-color": "tb-selected-border-color",
    "tb-width": "tb-width",
    thumbnails: "thumbnails",
  },
  "dys-carousel-image": {
    alt: "alt",
    "css-class": null, // Not supported by DML
    href: "href",
    rel: "rel",
    src: "src",
    target: "target",
    "thumbnail-src": "thumbnail-src",
    title: "title",
  },
  "dys-social": {
    align: "align",
    "border-radius": "border-radius",
    color: "color",
    "css-class": "css-class",
    "container-background-color": "container-background-color",
    "font-family": "font-family",
    "font-size": "font-size",
    "font-style": "font-style",
    "font-weight": "font-weight",
    "font-height": null, // Not supported by DML
    "icon-height": "icon-height",
    "icon-size": "icon-size",
    "inner-padding": "inner-padding",
    "line-height": "line-height",
    mode: "mode",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    "icon-padding": "icon-padding",
    "text-padding": "text-padding",
    "text-decoration": "text-decoration",
  },
  "dys-social-element": {
    align: "align",
    alt: "alt",
    "background-color": "background-color",
    "border-radius": "border-radius",
    color: "color",
    "css-class": "css-class",
    "font-family": "font-family",
    "font-size": "font-size",
    "font-style": "font-style",
    "font-weight": "font-weight",
    href: "href",
    "icon-height": "icon-height",
    "icon-size": "icon-size",
    "line-height": "line-height",
    name: "name",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    "icon-padding": "icon-padding",
    "text-padding": "text-padding",
    sizes: "sizes",
    src: "src",
    srcset: "srcset",
    rel: null, // Not supported by DML
    target: "target",
    title: "title",
    "text-decoration": "text-decoration",
    "vertical-align": "vertical-align",
  },
  "dys-divider": {
    align: "align",
    "border-color": "border-color",
    "border-style": "border-style",
    "border-width": "border-width",
    "container-background-color": "container-background-color",
    "css-class": "css-class",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
    width: "width",
  },
  "dys-spacer": {
    "container-background-color": "container-background-color",
    "css-class": "css-class",
    height: "height",
    padding: "padding",
    "padding-bottom": "padding-bottom",
    "padding-left": "padding-left",
    "padding-right": "padding-right",
    "padding-top": "padding-top",
  },
};

const requiredParentTags: { [key: string]: string } = {
  "dys-row": "dys-block",
  "dys-column": "dys-row",
  // we can add more as needed, but these seem to be the common root tags GPT spits out
};

async function renameTags(xmlSnippet: string): Promise<string> {
  const parser = new xml2js.Parser();
  const builder = new xml2js.Builder();

  try {
    const ast = await parser.parseStringPromise(xmlSnippet);
    const renamedAst = traverseAndRename(ast);
    const validatedAst = validateAndRenameAttributes(renamedAst);
    const wrappedAst = wrapWithTag(validatedAst);
    const renamedXmlSnippet = builder.buildObject(wrappedAst);

    // remove the first line of the xml snippet, which is the xml declaration
    const snippetNoFirstLine = renamedXmlSnippet
      .split("\n")
      .slice(1)
      .join("\n");
    return snippetNoFirstLine;
  } catch (error) {
    console.error("Error parsing or rebuilding XML:", error);
    // if theres an error, just return the original snippet
    return xmlSnippet;
  }
}

function traverseAndRename(node: any): any {
  if (typeof node === "object") {
    const keys = Object.keys(node);
    keys.forEach((key) => {
      const mappedKey = tagMappings[key];
      if (mappedKey === null) {
        // Remove tag and keep children intact
        const children = node[key][0];
        delete node[key];
        Object.assign(node, children);

        // continue traversing
        traverseAndRename(node);
      } else {
        const newKey = mappedKey || key;
        if (newKey !== key) {
          node[newKey] = node[key];
          delete node[key];
        }
        traverseAndRename(node[newKey]);
      }
    });
  }
  return node;
}

function validateAndRenameAttributes(node: any): any {
  if (typeof node === "object") {
    const keys = Object.keys(node);
    keys.forEach((key) => {
      const attributes = node[key][0]?.["$"];
      if (attributes) {
        const legalAttributes = attributeMappings[key];
        if (legalAttributes) {
          Object.keys(attributes).forEach((attributeKey) => {
            const mappedAttribute = legalAttributes[attributeKey];
            if (mappedAttribute === null) {
              delete attributes[attributeKey];
            } else if (mappedAttribute && mappedAttribute !== attributeKey) {
              attributes[mappedAttribute] = attributes[attributeKey];
              delete attributes[attributeKey];
            } else if (!legalAttributes.hasOwnProperty(attributeKey)) {
              delete attributes[attributeKey];
            }
          });
        }
      }
      validateAndRenameAttributes(node[key]);
    });
  }
  return node;
}

function wrapWithTag(node: any): any {
  const keys = Object.keys(node);
  keys.forEach((key) => {
    const parentTag = requiredParentTags[key];
    if (parentTag) {
      const wrappedNode: any = {};
      wrappedNode[parentTag] = [node];
      node = wrappedNode;
    }
  });

  return node;
}

const dmlify = async (mjml: string[]) => {
  const dmlBlocks: string[] = [];
  for (const mjmlBlock of mjml) {
    const dmlBlock = await renameTags(mjmlBlock);
    dmlBlocks.push(dmlBlock);
  }
  return dmlBlocks;
};

const getSortedFileNames = async (folderName: string): Promise<string[]> => {
  const files = await readdir(folderName);
  const fileContents = await Promise.all(
    files.map(async (fileName) => {
      const filePath = path.join(folderName, fileName);
      const fileData = await readFile(filePath, "utf-8");
      return fileData;
    })
  );
  return fileContents.sort((a, b) => files.indexOf(a) - files.indexOf(b));
};

async function main() {
  console.clear();

  if (runType === RUN_TYPE.DMLIFY_TEST) {
    console.log("[DEBUG] Running DMLIFY_TEST, skipping prompts...");
    // read the MJML blocks from the /mjml folder
    const mjmlBlocks = await getSortedFileNames("mjml");
    const dmlBlocks = await dmlify(mjmlBlocks);
    await createFolderIfNotExist("dml");
    dmlBlocks.forEach((block, i) => {
      // write the DML blocks to the /dml folder
      writeFile(`dml/output-${i}.dml`, block);
    });
    console.log(`[DEBUG] Saved ${dmlBlocks.length} DML chunks to dml/ folder.`);
    return;
  }

  const fileName: string = prompt("File to Convert: ");
  // Open the file and read the contents to a string
  const contents = await readFile(fileName, "utf8");

  console.clear();
  console.log("Breaking HTML into blocks...");

  // break the HTML into "blocks"
  const blocks = autoBlockify(contents, 4000);

  console.clear();
  console.log(`Found ${blocks.length} blocks.`);

  if (runType === RUN_TYPE.BLOCKIFY_TEST) {
    console.log(
      "[DEBUG] Blockify Process Complete. Saving HTML chunks and Exiting..."
    );
    await createFolderIfNotExist("html");
    blocks.forEach((block, i) => {
      writeFile(`html/output-${i}.html`, block);
    });
    console.log(`[DEBUG] Saved ${blocks.length} HTML chunks to html/ folder.`);
    return;
  }

  console.log("Converting HTML to MJML...");

  let mjmlBlocks: string[] = [];
  // convert each block to MJML
  if (runType === RUN_TYPE.GPT_TEST) {
    console.log(`[DEBUG] GPT_TEST mode active, only processing first block...`);
    mjmlBlocks = [await convertToMJML(blocks[0])];
  } else {
    mjmlBlocks = await Promise.all(
      blocks.map(async (block) => {
        return await convertToMJML(block);
      })
    );
  }

  console.log("Writing MJML to files...");

  // write each block to a file
  await createFolderIfNotExist("mjml");
  await Promise.all(
    mjmlBlocks.map(async (block, i) => {
      await writeFile(`mjml/output-${i}.mjml`, block);
    })
  );

  if (runType === RUN_TYPE.GPT_TEST) {
    console.log(`[DEBUG] MJMLIFY Test complete, exiting.`);
    console.log("[DEBUG] MJML saved to mjml/output-[BLOCK_NUMBER].mjml.");
    return;
  }

  const dmlBlocks = await dmlify(mjmlBlocks);
  await createFolderIfNotExist("dml");
  dmlBlocks.forEach((block, i) => {
    // write the DML blocks to the /dml folder
    writeFile(`dml/output-${i}.dml`, block);
  });

  console.log("MJML saved to mjml/output-[BLOCK_NUMBER].mjml.");
  console.log("DML saved to dml/output-[BLOCK_NUMBER].dml.");
  console.log("");
  console.log(
    "End results may not be 100% accurate, some attributes may be invalid and need to be manually removed. Some images may be larger than expected"
  );
}

main();
