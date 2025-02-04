import { EthereumDexPrice, GoerliDexPrice } from './dex-price.js'
import { State } from '@sentio/runtime'
import { loadTestProvidersFromEnv } from '@sentio/sdk/testing'

import { expect } from 'chai'

describe('dex price tests', () => {
  State.reset()
  // Endpoints.reset()

  const haveProviders = loadTestProvidersFromEnv(['1', '5'])

  const testIf = haveProviders ? test : test.skip

  testIf('get price at mainnet', async () => {
    const usdc = await EthereumDexPrice.getPrice('usdc', 15677823)
    expect(usdc.price).eq(0.99991649)

    const compound = await EthereumDexPrice.getPrice('COMP', 15677823)
    expect(compound.price).eq(60.27)
  })

  testIf('get price at goerli', async () => {
    const dai = await GoerliDexPrice.getPrice('DAI', 7712734)
    expect(dai.price).eq(0.99971281)
  })
})
