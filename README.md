# Hard RPS AI

A static rock paper scissors playground with a hard but fair adaptive AI.

Run it from this directory:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173/`.

The AI locks its move before scoring your current click. It only uses completed round history, combining frequency, recency, Markov, outcome-response, anti-repeat, and revenge-read predictors.
