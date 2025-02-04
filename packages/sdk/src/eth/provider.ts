import { JsonRpcProvider, Network, Provider } from 'ethers'

import PQueue from 'p-queue'
import { Endpoints } from '@sentio/runtime'
import { EthChainId } from '@sentio/chain'
import { LRUCache } from 'lru-cache'

export const DummyProvider = new JsonRpcProvider('', Network.from(1))

const providers = new Map<string, JsonRpcProvider>()

// export function getEthChainId(networkish?: EthContext | EthChainId): EthChainId {
//   if (!networkish) {
//     networkish = EthChainId.ETHEREUM
//   }
//   if (networkish instanceof BaseContext) {
//     networkish = networkish.getChainId()
//   }
//   return networkish
// }

export function getProvider(chainId?: EthChainId): Provider {
  // const network = getNetworkFromCtxOrNetworkish(networkish)
  if (!chainId) {
    chainId = EthChainId.ETHEREUM
  }
  const network = Network.from(parseInt(chainId))
  // TODO check if other key needed

  const address = Endpoints.INSTANCE.chainServer.get(chainId)
  const key = network.chainId.toString() + '-' + address
  let provider = providers.get(key)

  if (provider) {
    return provider
  }

  if (address === undefined) {
    throw Error(
      'Provider not found for chain ' +
        network.chainId +
        ', configured chains: ' +
        [...Endpoints.INSTANCE.chainServer.keys()].join(' ')
    )
  }
  provider = new QueuedStaticJsonRpcProvider(address, network, Endpoints.INSTANCE.concurrency)
  providers.set(network.chainId.toString(), provider)
  return provider
}

function getTag(prefix: string, value: any): string {
  return (
    prefix +
    ':' +
    JSON.stringify(value, (k, v) => {
      if (v == null) {
        return 'null'
      }
      if (typeof v === 'bigint') {
        return `bigint:${v.toString()}`
      }
      if (typeof v === 'string') {
        return v.toLowerCase()
      }

      // Sort object keys
      if (typeof v === 'object' && !Array.isArray(v)) {
        const keys = Object.keys(v)
        keys.sort()
        return keys.reduce(
          (accum, key) => {
            accum[key] = v[key]
            return accum
          },
          <any>{}
        )
      }

      return v
    })
  )
}

class QueuedStaticJsonRpcProvider extends JsonRpcProvider {
  executor: PQueue
  #performCache = new LRUCache<string, Promise<any>>({
    max: 10000
  })

  constructor(url: string, network: Network, concurrency: number) {
    // TODO re-enable match when possible
    super(url, network, { staticNetwork: network, batchMaxCount: 1 })
    this.executor = new PQueue({ concurrency: concurrency })
  }

  async send(method: string, params: Array<any>): Promise<any> {
    if (method !== 'eth_call') {
      return super.send(method, params)
    }
    const tag = getTag(method, params)
    const block = params[params.length - 1]
    let perform = this.#performCache.get(tag)
    if (!perform) {
      perform = this.executor.add(() => super.send(method, params))
      perform.catch((e) => {
        // if (e.code !== 'CALL_EXCEPTION' && e.code !== 'BAD_DATA') {
        setTimeout(() => {
          if (this.#performCache.get(tag) === perform) {
            this.#performCache.delete(tag)
          }
        }, 1000)
        // }
        // if (e.code === 'CALL_EXCEPTION' && !e.data) {
        //   setTimeout(() => {
        //     if (this.#performCache.get(tag) === perform) {
        //       this.#performCache.delete(tag)
        //     }
        //   }, 1000)
        // }
      })
      this.#performCache.set(tag, perform)
      // For non latest block call, we cache permanently, otherwise we cache for one minute
      if (block === 'latest') {
        setTimeout(() => {
          if (this.#performCache.get(tag) === perform) {
            this.#performCache.delete(tag)
          }
        }, 60 * 1000)
      }
    }

    const result = await perform
    if (!result) {
      throw Error('Unexpected null response')
    }
    return result
  }
}
