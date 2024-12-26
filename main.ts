type Primitive = string | number | boolean;
type BaseContent = Primitive | Tag;
type ArrayContent = (Primitive | Tag)[];
type TagContent = BaseContent | ArrayContent;
type BaseTagParams = Record<string, Primitive>;
type ConditionTagParams = { condition: string } & BaseTagParams;
type ConditionsTagContent = (IfTag | ElseIfTag | ElseTag)[];

type TagDefinition = {
  string: {
    content: string;
    params: BaseTagParams;
  };
  number: {
    content: number;
    params: BaseTagParams;
  };
  boolean: {
    content: boolean;
    params: BaseTagParams;
  };
  if: {
    content: TagContent;
    params: ConditionTagParams;
  };
  elseif: {
    content: TagContent;
    params: ConditionTagParams;
  };
  else: {
    content: TagContent;
    params: BaseTagParams;
  };
  conditions: {
    content: ConditionsTagContent;
    params: BaseTagParams;
  };
  array: {
    content: ArrayContent;
    params: BaseTagParams;
  };
};

type TagContentType<T extends keyof TagDefinition> =
  TagDefinition[T]["content"];
type TagParamsType<T extends keyof TagDefinition> = TagDefinition[T]["params"];

interface BaseTag<T extends keyof TagDefinition> {
  type: T;
  name: string;
  params?: TagParamsType<T>;
  content: TagContentType<T>;
}

type StringTag = BaseTag<"string">;
type NumberTag = BaseTag<"number">;
type BooleanTag = BaseTag<"boolean">;
type IfTag = BaseTag<"if">;
type ElseIfTag = BaseTag<"elseif">;
type ElseTag = BaseTag<"else">;
type ConditionsTag = BaseTag<"conditions">;
type ArrayTag = BaseTag<"array">;

type Tag =
  | StringTag
  | NumberTag
  | BooleanTag
  | ConditionsTag
  | IfTag
  | ElseIfTag
  | ElseTag
  | ArrayTag;

function tag<T extends keyof TagDefinition>(
  name: string,
  type: T,
  content: TagContentType<T>,
): BaseTag<T>;
function tag<T extends keyof TagDefinition>(
  name: string,
  type: T,
  params: TagParamsType<T>,
  content: TagContentType<T>,
): BaseTag<T>;
function tag<T extends keyof TagDefinition>(
  name: string,
  type: T,
  paramsOrContent: TagParamsType<T> | TagContentType<T>,
  content?: TagContentType<T>,
) {
  return {
    type,
    name,
    params: content ? (paramsOrContent as TagParamsType<T>) : undefined,
    content: content ?? paramsOrContent,
  } as BaseTag<T>;
}

type PrimitiveTypeName = "string" | "number" | "boolean";

const XMLParams = <T extends keyof TagDefinition>(
  params?: TagParamsType<T>,
): string => {
  if (!params || Object.keys(params).length === 0) return "";

  let output = " ";

  const keys = Object.keys(params);

  for (let i = 0; i < keys.length; i++) {
    output += `${keys[i]}="${params[keys[i]]}"`;
  }

  return output;
};

const indent = (depth: number): string => {
  return depth < 0 ? "" : " ".repeat(depth * 2);
};

const PRIMITIVE_TYPES: PrimitiveTypeName[] = ["string", "number", "boolean"];

const XMLContent = (content: TagContent, depth = 0): string => {
  if (PRIMITIVE_TYPES.includes(typeof content as PrimitiveTypeName)) {
    return `${indent(depth)}${content}`;
  }

  if (Array.isArray(content)) {
    return content.map((v) => XMLContent(v, depth)).join("\n\n");
  }

  return XMLTag(content as Tag, depth);
};

const XMLTag = <T extends keyof TagDefinition>(
  tag: BaseTag<T>,
  depth = 0,
): string => {
  return `${indent(depth)}<${tag.name}${XMLParams<T>(tag.params)}>\n${
    XMLContent(
      tag.content,
      depth + 1,
    )
  }\n${indent(depth)}</${tag.name}>`;
};

const $string = (
  name: string,
  content: string,
  params: BaseTagParams = {},
): StringTag => tag(name, "string", params, content);

const $number = (
  name: string,
  content: number,
  params: BaseTagParams = {},
): NumberTag => tag(name, "number", params, content);

const $conditions = (
  name: string,
  content: ConditionsTagContent,
  params: BaseTagParams = {},
): ConditionsTag => tag(name, "conditions", params, content);

const $if = (content: TagContent, params: ConditionTagParams): IfTag =>
  tag("if", "if", params, content);

const $elseif = (content: TagContent, params: ConditionTagParams): ElseIfTag =>
  tag("elseif", "elseif", params, content);

const $else = (content: TagContent, params: BaseTagParams = {}): ElseTag =>
  tag("else", "else", params, content);

const $array = (
  name: string,
  content: ArrayContent,
  params: BaseTagParams = {},
): ArrayTag => tag(name, "array", params, content);

const test = [
  $string(
    "role",
    "You're an API endpoint that accepts age and returns age group that the age falls into.",
  ),

  $array("input", [
    $string("type", "integer"),
    $string("range", "0-120"),
    $string("format", "single number"),
  ]),

  $array("output", [
    $string("type", "string"),
    $string("format", "single word, lowercase"),
    $array("possible_values", [
      $string("value", "infant"),
      $string("value", "toddler"),
      $string("value", "kid"),
      $string("value", "teen"),
      $string("value", "adult"),
      $string("value", "ERROR_[type]"),
    ]),
  ]),

  $conditions("conditions", [
    $if("infant", { condition: "age < 1" }),
    $elseif("toddler", { condition: "age < 5" }),
    $elseif("kid", { condition: "age < 13" }),
    $elseif("teen", { condition: "age < 18" }),
    $else("adult"),
  ]),

  $array("errors", [
    $if("ERROR_NOT_INTEGER", { condition: "isInteger(age) == false" }),
    $elseif("ERROR_OUT_OF_RANGE", { condition: "age < 0 || age > 120" }),
  ]),

  $array("examples", [
    $array("example", [$number("input", 0), $string("output", "infant")]),
    $array("example", [$number("input", 3), $string("output", "toddler")]),
    $array("example", [$number("input", 7), $string("output", "kid")]),
    $array("example", [$number("input", 15), $string("output", "teen")]),
    $array("example", [$number("input", 28), $string("output", "adult")]),
    $array("example", [
      $number("input", -1),
      $string("output", "ERROR_OUT_OF_RANGE"),
    ]),
    $array("example", [
      $number("input", 15.5),
      $string("output", "ERROR_NOT_INTEGER"),
    ]),
  ]),
];

console.log(XMLContent(test, 0));
