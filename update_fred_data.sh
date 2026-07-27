#!/bin/bash
# Fetch latest data from FRED
echo "Fetching FEDFUNDS..."
curl -s -L "https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS" > sketches/banking/FEDFUNDS.csv

echo "Fetching UNRATE..."
curl -s -L "https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE" > sketches/banking/UNRATE.csv

echo "Fetching CPIAUCSL..."
curl -s -L "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL" > sketches/banking/CPIAUCSL.csv

echo "Done!"
