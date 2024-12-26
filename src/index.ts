const ONE_MINUTE_MS = 60_000;

const STEP_SIZE_MIN = 1;
const STEP_SIZE_MAX = 32;

const STEP_POSITIVE_AMOUNT = 0.1;
const STEP_NEGATIVE_AMOUNT = -0.5;

const RETRY_COUNT = 10;
const RETRY_MIN = 1;
const RETRY_MULTIPLIER = 1.85;
const RETRY_ERRORS = ["408", "429", "503", "529"];

// TODO: just check if code or status exist instead
class NetworkError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.code = code;
  }
}

type Prompt = {
  id: number;
  system: string;
  user: string;
  retries: number;
};

type Data = {
  done: boolean;
  data: Prompt[];
};

type Runner = {
  chat: (prompt: Prompt, abort_controller: AbortController) => Promise<string>;
};

type Model = {
  name: string;
  rpm: number;
  max_tokens: number;
};

type Database = {
  load: (cursor: number, limit: number) => Promise<Data>;
  save: (prompt: Prompt, output: string) => Promise<void>;
};

type Config = {
  runner: Runner;
  model: Model;
  database: Database;
};

type Queue = (Prompt | null)[];

type Resolve = (value: unknown) => void;

class Prompter {
  private readonly runner: Runner;
  private readonly model: Model;
  private readonly database: Database;

  private resolve?: Resolve;

  private readonly queue: Queue;
  private readonly queue_size: number;
  private queue_count: number;

  private step_index: number;
  private step_size_float: number;
  private step_size_int: number;

  private load_interval?: number;
  private readonly load_interval_duration: number;
  private load_cursor: number;
  private readonly load_limit: number;
  private readonly load_threshold: number;

  private chat_interval?: number;
  private readonly chat_interval_duration: number;
  private chat_active: number;

  private wait_interval?: number;
  private readonly wait_interval_duration: number;

  private readonly abort_controller: AbortController;

  constructor(config: Config) {
    this.runner = config.runner;
    this.model = config.model;
    this.database = config.database;

    const queue_size = config.model.rpm * 2;

    this.queue = new Array(queue_size).fill(null);
    this.queue_size = queue_size;
    this.queue_count = 0;

    this.step_index = 0;
    this.step_size_float = 0;
    this.step_size_int = 0;

    const load_limit = Math.floor(config.model.rpm / 4);

    this.load_interval_duration = ONE_MINUTE_MS / load_limit;
    this.load_cursor = 0;
    this.load_limit = load_limit;
    this.load_threshold = Math.ceil(load_limit / 2);

    this.chat_interval_duration = ONE_MINUTE_MS / config.model.rpm;
    this.chat_active = 0;

    this.wait_interval_duration = 1_000;

    this.abort_controller = new AbortController();
  }

  private setup_wait_interval() {
    this.wait_interval = setInterval(() => {
      if (this.chat_active === 0) {
        clearInterval(this.wait_interval);
        this.resolve!(true);
      }
    }, this.wait_interval_duration);
  }

  private push_prompts_to_queue(prompts: Prompt[]) {
    const prompt_max = prompts.length - 1;

    let prompt_index = 0;

    for (let queue_index = 0; queue_index < this.queue_size; ++queue_index) {
      if (this.queue[queue_index] === null) {
        this.queue[queue_index] = prompts[prompt_index];
        this.queue_count += 1;

        if (prompt_index === prompt_max) {
          this.load_cursor = prompts[prompt_index].id;
          return;
        }

        prompt_index += 1;
      }
    }
  }

  private setup_load_interval() {
    this.load_interval = setInterval(async () => {
      if (this.queue_count >= this.load_threshold) {
        return;
      }

      const response = await this.database.load(
        this.load_cursor,
        this.load_limit,
      );

      if (response.done) {
        clearInterval(this.load_interval);
        this.setup_wait_interval();
        return;
      }

      this.push_prompts_to_queue(response.data);
    }, this.load_interval_duration);
  }

  private shift_queue() {
    for (
      let queue_index = 0;
      queue_index < this.queue_size - 1;
      ++queue_index
    ) {
      this.queue[queue_index] = this.queue[queue_index + 1];
    }

    this.queue[this.queue_size] = null;
  }

  private update_step_size(value: number) {
    this.step_size_float = value > 0
      ? Math.min(this.step_size_float + value, STEP_SIZE_MAX)
      : Math.max(this.step_size_float + value, STEP_SIZE_MIN);
    this.step_size_int = Math.round(this.step_size_float);
  }

  private increment_step_index() {
    this.step_size_int = this.step_size_int === this.step_index
      ? 0
      : this.step_size_int + 1;
  }

  private abort() {
    clearInterval(this.chat_interval);
    clearInterval(this.load_interval);
    clearInterval(this.wait_interval);

    this.abort_controller.abort();
    this.resolve!(false);
  }

  private find_closest_queue_index(prompt: Prompt) {
    const exact_index = Math.min(
      Math.floor(
        (prompt.retries + RETRY_MIN) ** RETRY_MULTIPLIER *
          (0.75 + Math.random() * 0.25),
      ),
      this.queue_size,
    );

    if (this.queue[exact_index] === null) {
      return exact_index;
    }

    if (exact_index < this.queue_size) {
      for (
        let higher_index = exact_index + 1;
        higher_index < this.queue_size;
        ++higher_index
      ) {
        if (this.queue[higher_index] === null) {
          return higher_index;
        }
      }
    }

    if (exact_index > 0) {
      for (
        let lower_index = exact_index - 1;
        lower_index > 0;
        --lower_index
      ) {
        if (this.queue[lower_index] === null) {
          return lower_index;
        }
      }
    }

    return null;
  }

  private schedule_prompt(prompt: Prompt) {
    if (prompt.retries < RETRY_COUNT) {
      const queue_index = this.find_closest_queue_index(prompt);

      if (queue_index === null) {
        console.log("ERROR: Couldn't find closest index", prompt);
        return;
      }

      this.queue[queue_index] = prompt;

      prompt.retries += 1;
    } else {
      console.log("ERROR: Reached maximum count of retries", prompt);
    }
  }

  private should_retry(error: NetworkError) {
    // TODO: check which errors are retryable
    return RETRY_ERRORS.includes(error.code) ||
      error.message.includes("tokens");
  }

  private async send_prompt(prompt: Prompt) {
    try {
      this.chat_active += 1;
      await this.runner.chat(prompt, this.abort_controller);
      this.update_step_size(STEP_POSITIVE_AMOUNT);
    } catch (error) {
      if (error instanceof NetworkError) {
        if (this.should_retry(error)) {
          this.update_step_size(STEP_NEGATIVE_AMOUNT);
          this.schedule_prompt(prompt);
        } else {
          console.log("ERROR: Unknown NetworkError error", prompt, error);
          this.abort();
        }
      } else {
        console.log("ERROR: Unknown Error error", prompt, error);
        this.abort();
      }
    }

    this.chat_active -= 1;
  }

  private setup_chat_interval() {
    this.chat_interval = setInterval(async () => {
      if (this.queue_count > 0) {
        if (this.step_index === 0 && this.queue[0] !== null) {
          await this.send_prompt(this.queue[0]);
        }

        this.increment_step_index();
        this.shift_queue();
      }
    }, this.chat_interval_duration);
  }

  public start() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.setup_load_interval();
      this.setup_chat_interval();
    });
  }
}
