export default class BlackjackMini {
  constructor() {
    this.scene = null;
    this.parent = null;
    this.root = null;

    this.width = 0;
    this.height = 0;

    this.text = null;

    this.playerCards = [];
    this.dealerCards = [];

    this.phase = "idle";
    this.resultLine = "";

    this.lives = 5;
    this.wins = 0;

    this.canDoubleDown = false;
    this.roundDoubled = false;
    this.extraLifePaid = false;
  }

  getName() {
    return "BLACKJACK";
  }

  start({ scene, container, width, height }) {
    this.scene = scene;
    this.parent = container;
    this.width = Math.max(96, Math.round(width));
    this.height = Math.max(80, Math.round(height));

    this.root = scene.add.container(0, 0);
    this.parent.add(this.root);

    this.text = scene.add.text(8, 6, "", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#dbe8ff",
      lineSpacing: 1,
      wordWrap: { width: this.width - 16 },
    }).setOrigin(0, 0);

    this.root.add(this.text);

    this.reset();
  }

  reset() {
    this.lives = 5;
    this.wins = 0;
    this.playerCards = [];
    this.dealerCards = [];
    this.phase = "idle";
    this.resultLine = "COST: 1 LIFE";
    this.canDoubleDown = false;
    this.roundDoubled = false;
    this.extraLifePaid = false;
    this.render();
  }

  drawCard() {
    return 1 + Math.floor(Math.random() * 10);
  }

  cardLabel(v) {
    if (v === 1) return "A";
    return String(v);
  }

  cardsToText(cards) {
    if (!cards.length) return "-";
    return cards.map((value) => this.cardLabel(value)).join(" ");
  }

  handTotal(cards) {
    let total = 0;
    let aces = 0;

    for (let i = 0; i < cards.length; i += 1) {
      const value = cards[i];
      if (value === 1) {
        total += 11;
        aces += 1;
      } else {
        total += value;
      }
    }

    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }

    return total;
  }

  canDealRound() {
    return this.lives > 0;
  }

  startRound() {
    if (!this.canDealRound()) {
      this.phase = "gameover";
      this.resultLine = "NO LIVES LEFT";
      this.render();
      return false;
    }

    this.lives -= 1;
    this.playerCards = [this.drawCard(), this.drawCard()];
    this.dealerCards = [this.drawCard(), this.drawCard()];

    this.phase = "player";
    this.resultLine = "YOUR TURN";

    this.canDoubleDown = this.lives > 0;
    this.roundDoubled = false;
    this.extraLifePaid = false;
    this.render();
    return true;
  }

  playerHit() {
    if (this.phase !== "player") return;
    this.playerCards.push(this.drawCard());
    this.canDoubleDown = false;
    if (this.handTotal(this.playerCards) > 21) {
      this.finishRound("lose", "BUST! DEALER WINS");
    } else {
      this.render();
    }
  }

  playerStand() {
    if (this.phase !== "player") return;
    this.canDoubleDown = false;
    this.resolveDealerAndFinish();
  }

  playerDoubleDown() {
    if (this.phase !== "player" || !this.canDoubleDown || this.playerCards.length !== 2) return;
    if (this.lives <= 0) return;

    this.lives -= 1;
    this.roundDoubled = true;
    this.extraLifePaid = true;
    this.canDoubleDown = false;

    this.playerCards.push(this.drawCard());
    if (this.handTotal(this.playerCards) > 21) {
      this.finishRound("lose", "DOUBLE DOWN BUST");
      return;
    }

    this.resolveDealerAndFinish();
  }

  resolveDealerAndFinish() {
    while (this.handTotal(this.dealerCards) < 17) {
      this.dealerCards.push(this.drawCard());
    }

    const playerTotal = this.handTotal(this.playerCards);
    const dealerTotal = this.handTotal(this.dealerCards);

    let outcome = "push";
    let line = "PUSH";

    if (dealerTotal > 21) {
      outcome = "win";
      line = "DEALER BUSTS, YOU WIN";
    } else if (playerTotal > dealerTotal) {
      outcome = "win";
      line = "YOU WIN";
    } else if (playerTotal < dealerTotal) {
      outcome = "lose";
      line = "DEALER WINS";
    }

    this.finishRound(outcome, line);
  }

  finishRound(outcome, line) {
    if (outcome === "win") {
      this.wins += 1;
      if (this.roundDoubled && this.extraLifePaid) {
        this.wins += 1;
      }
      this.lives += 1;
      if (this.roundDoubled && this.extraLifePaid) {
        this.lives += 1;
      }
    }

    this.phase = this.lives > 0 ? "result" : "gameover";

    if (this.phase === "result") {
      this.resultLine = line;
    } else {
      this.resultLine = `${line}\nNO LIVES LEFT`;
    }

    this.canDoubleDown = false;
    this.render();
  }

  tick(_now, input) {
    if (this.phase === "idle") {
      if (input?.aJust) this.startRound();
      return { done: false, score: this.wins };
    }

    if (this.phase === "player") {
      const playerTotal = this.handTotal(this.playerCards);
      if (playerTotal === 21) {
        this.canDoubleDown = false;
        if (input?.aJust || input?.down || input?.up) this.playerStand();
      } else if (input?.aJust) this.playerHit();
      else if (input?.up) this.playerDoubleDown();
      else if (input?.down) this.playerStand();
      return { done: false, score: this.wins };
    }

    if (this.phase === "result") {
      if (input?.aJust) this.startRound();
      return { done: true, score: this.wins, message: "ROUND COMPLETE" };
    }

    // gameover
    if (input?.aJust) this.reset();
    return { done: true, score: this.wins, message: "OUT OF LIVES" };
  }

  render() {
    const playerTotal = this.handTotal(this.playerCards);
    const dealerTotal = this.handTotal(this.dealerCards);

    const dealerText =
      this.phase === "player"
        ? `${this.cardLabel(this.dealerCards[0])} ?`
        : this.cardsToText(this.dealerCards);

    const dealerTotalText = this.phase === "player" ? "?" : String(dealerTotal);

    let prompt = "A:DEAL";
    if (this.phase === "player") {
      if (playerTotal === 21) prompt = "A:STAND";
      else prompt = this.canDoubleDown ? "A:HIT DOWN:STAND UP:DOUBLE" : "A:HIT DOWN:STAND";
    } else if (this.phase === "result") {
      prompt = "A:DEAL NEXT  B:QUIT";
    } else if (this.phase === "gameover") {
      prompt = "A:RESET  B:QUIT";
    }

    this.text.setText(
      `BLACKJACK\nLIVES: ${this.lives}   WINS: ${this.wins}\n\nDEALER: ${dealerText}\nDEALER TOTAL: ${dealerTotalText}\n\nPLAYER: ${this.cardsToText(this.playerCards)}\nPLAYER TOTAL: ${this.playerCards.length ? playerTotal : "-"}\n\n${this.resultLine}\n${prompt}`
    );
  }

  destroy() {
    this.root?.destroy?.(true);
    this.root = null;
    this.text = null;
  }
}
