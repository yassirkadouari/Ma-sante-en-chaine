#!/bin/bash
set -e

echo "====================================="
echo "  Ma Sante En Chaine - Deploy Script "
echo "====================================="

# Check for required tools
if ! command -v cargo-contract &> /dev/null; then
    echo "❌ cargo-contract could not be found. Please install it."
    exit 1
fi

echo "📦 Building smart contract..."
cd smart-contracts/ink-medical-anchors
cargo contract build

echo "🚀 Instantiating contract on local dev node..."
SALT=$(date +%s)
OUTPUT=$(cargo contract instantiate \
  --constructor new \
  --suri //Alice \
  --salt $SALT \
  --skip-confirm \
  -x 2>&1)

# Extract contract address using grep and sed
CONTRACT_ADDRESS=$(echo "$OUTPUT" | grep "Contract " | awk '{print $2}')

if [ -z "$CONTRACT_ADDRESS" ]; then
    echo "❌ Failed to extract contract address from output:"
    echo "$OUTPUT"
    exit 1
fi

echo "✅ Contract deployed successfully at: $CONTRACT_ADDRESS"

echo "📝 Updating frontend environment..."
cd ../../frontend

# Update .env.local with new address
if [ -f .env.local ]; then
    # Cross-platform sed for updating the contract address
    sed -i.bak "s/^NEXT_PUBLIC_CONTRACT_ADDRESS=.*/NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT_ADDRESS/" .env.local
    rm -f .env.local.bak
    echo "✅ Updated NEXT_PUBLIC_CONTRACT_ADDRESS in frontend/.env.local"
else
    echo "⚠️ frontend/.env.local not found. Creating one..."
    echo "NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT_ADDRESS" > .env.local
fi

echo "📋 Copying contract metadata..."
mkdir -p public/contracts
cp ../smart-contracts/ink-medical-anchors/target/ink/medical_anchors_contract.json public/contracts/
echo "✅ Copied medical_anchors_contract.json to frontend/public/contracts/"

echo ""
echo "🎉 Deployment Complete!"
echo "Make sure your substrate node is running:"
echo "substrate-contracts-node --dev -d ./blockchain-data"
