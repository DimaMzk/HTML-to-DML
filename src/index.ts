import { Configuration, OpenAIApi } from "openai";
const prompt = require("prompt-sync")({ sigint: true });
import { readFile, writeFile } from "fs/promises";
import { decode } from "html-entities";
var xml2js = require("xml2js");
// get API key from process.env
require("dotenv").config();

// https://platform.openai.com/account/api-keys
const API_KEY = process.env.API_KEY;

const configuration = new Configuration({
  apiKey: API_KEY,
});
const openai = new OpenAIApi(configuration);

async function generateText(prompt: string) {
  // calculate the number of tokens in the prompt
  // 1 token = 4 characters
  const tokens = prompt.length / 4;
  // calculate the number of tokens to generate
  // The Max number of tokens is technically 4000,
  // but our method of calculating the number of tokens is horribly inaccurate
  // so we'll use 3000 to give a large buffer
  const maxTokens: number = Math.floor(3000 - tokens);
  const completion = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: prompt,
    temperature: 0.6,
    max_tokens: maxTokens,
  });
  if (completion.status < 200 || completion.status > 299) {
    console.log(`Error: " + completion.status + " - " + completion.statusText`);
    return `Error: ${completion.status} - ${completion.statusText}`;
  }
  return completion.data.choices[0].text;
}

async function convertToMJML(html: string) {
  const prompt = `Convert the following HTML Email to MJML, avoid using mj-table where possible, except for images that should be side by side. If using <br> tags, ensure that they are self closing e.g. <br />. Footers with social media icons should use mj-social: \n ${html}`;
  const MJML = await generateText(prompt);
  return MJML;
}

async function convertMJMLtoDML(MJML: string) {
  const parser = new xml2js.Parser();

  const parsed = await parser.parseStringPromise(MJML);

  const tags = [];

  function traverse(obj) {
    for (const key in obj) {
      tags.push(key);
      if (typeof obj[key] === "object") {
        traverse(obj[key]);
      }
    }
  }

  traverse(parsed);

  const tags_all = Array.from(new Set(tags)).filter((t) => t.startsWith("mj-"));

  // Create a prompt for each tag
  let prompt =
    "Convert the following MJML Email to DML - Here are the key differences between MJML and DML: \n";
  prompt +=
    "MJML uses <mjml> as the root element, DML uses <dys-block> as the root element. \n";
  prompt +=
    "MJML uses <mj-body> as the body element, DML does not have a body element, placing everything within <dys-block>. \n";
  prompt +=
    "MJML uses <mj-section> as the section element, DML uses <dys-row>. \n";
  prompt +=
    "MJML uses <mj-column> as the column element, DML uses <dys-column>. \n";

  // Create a prompt for each tag
  for (let i = 0; i < tags_all.length; i++) {
    switch (tags_all[i]) {
      case "mj-button":
        prompt +=
          "MJML uses <mj-button> as the button element, DML uses <dys-button>. \n";
        break;
      case "mj-divider":
        prompt +=
          "MJML uses <mj-divider> as the divider element, DML uses <dys-divider>. \n";
        break;
      case "mj-image":
        prompt +=
          "MJML uses <mj-image> as the image element, DML uses <dys-img>, if the width attribute contains 100%, replace it with 600px. \n";
        break;
      case "mj-text":
        prompt +=
          "MJML uses <mj-text> as the text element, DML uses <dys-text>. <p> tags within a dsy-text are redundant \n";
        break;
      case "mj-wrapper":
        prompt +=
          "MJML uses <mj-wrapper> as the wrapper element, DML uses <dys-wrapper>. \n";
        break;
      case "mj-social":
        prompt +=
          "MJML uses <mj-social> as the social element, DML uses <dys-social>. \n";
        break;
      case "mj-social-element":
        prompt +=
          "MJML uses <mj-social-element> as the social element, DML uses <dys-social-element>. \n";
        break;
      default:
        break;
    }
  }

  prompt += "\nHere is the MJML: \n\n" + MJML;

  const DML = await generateText(prompt);

  return DML;
}

async function main() {
  console.clear();
  const fileName: string = prompt("File to Convert: ");
  // Open the file and read the contents to a string
  const contents = await readFile(fileName, "utf8");

  console.clear();
  console.log("Converting HTML to MJML...");
  let MJML = decode(await convertToMJML(contents));
  // remove <code> and </code>
  MJML = MJML.replace(/<code>/g, "");
  MJML = MJML.replace(/<\/code>/g, "");

  // write the MJML to a file
  await writeFile("output.mjml", MJML);

  console.clear();
  console.log("Converting MJML to DML...");
  let DML = decode(await convertMJMLtoDML(MJML));
  console.clear();
  // remove <code> and </code>
  DML = DML.replace(/<code>/g, "");
  DML = DML.replace(/<\/code>/g, "");
  await writeFile("output.dml", DML);
  console.log("DML saved to output.dml.");
  console.log("MJML saved to output.mjml.");
  console.log("");
  console.log(
    "End results may not be 100% accurate, some attributes may be invalid and need to be manually removed. Some images may be larger than expected"
  );
}

main();
