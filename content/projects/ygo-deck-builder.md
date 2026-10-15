---
title: Yu-Gi-Oh! Deck Builder
date: 2026-10-15
summary: Build decks for TCG, OCG or Master Duel with each format's banlist, then export them as .ydk, ydke:// or an image.
tags: [yugioh, javascript]
link: /ygo/deck
---

A deck builder that runs in the browser. Pick a format (TCG, OCG or Master Duel) and it checks
the Main, Extra and Side Deck sizes, the 3-copy rule and that format's Forbidden & Limited list.

- Search every card by name, archetype or card text, and filter by type, attribute, level and banlist status
- Click to add, right-click for the Side Deck, or drag cards between decks
- Import and export `.ydk` files (EDOPro, YGO Omega) and `ydke://` codes, share a link, or save the deck as an image
- Decks are saved in your browser

Card data comes from [YGOPRODeck](https://ygoprodeck.com/) and the Master Duel banlist from
[Master Duel Meta](https://www.masterduelmeta.com/). `scripts/build_ygo_cards.py` rebuilds the card
database after a new set or banlist.
