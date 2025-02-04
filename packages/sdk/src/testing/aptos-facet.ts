import { Transaction_UserTransaction, TransactionPayload_EntryFunctionPayload } from '../aptos/index.js'
import { DataBinding, HandlerType } from '@sentio/protos'
import { TestProcessorServer } from './test-processor-server.js'
import { AptosNetwork } from '@sentio/sdk/aptos'
import { parseMoveType, accountTypeString } from '@sentio/sdk/move'

export class AptosFacet {
  server: TestProcessorServer
  constructor(server: TestProcessorServer) {
    this.server = server
  }

  testEntryFunctionCall(transaction: Transaction_UserTransaction, network: AptosNetwork = AptosNetwork.MAIN_NET) {
    return this.testEntryFunctionCalls([transaction], network)
  }

  testEntryFunctionCalls(transactions: Transaction_UserTransaction[], network: AptosNetwork = AptosNetwork.MAIN_NET) {
    const bindings = []
    for (const trans of transactions) {
      const binding = this.buildEntryFunctionCallBinding(trans, network)
      if (!binding) {
        throw Error('Invalid test transaction: ' + JSON.stringify(trans))
      }
      bindings.push(binding)
    }
    return this.server.processBindings({
      bindings: bindings
    })
  }

  private buildEntryFunctionCallBinding(
    transaction: Transaction_UserTransaction,
    network: AptosNetwork = AptosNetwork.MAIN_NET
  ): DataBinding | undefined {
    const payload = transaction.payload as TransactionPayload_EntryFunctionPayload
    for (const config of this.server.contractConfigs) {
      if (config.contract?.chainId !== network) {
        continue
      }
      for (const callConfig of config.moveCallConfigs) {
        for (const callFilter of callConfig.filters) {
          if (accountTypeString(config.contract.address) + '::' + callFilter.function === payload.function) {
            return {
              data: {
                aptCall: {
                  transaction
                }
              },
              handlerIds: [callConfig.handlerId],
              handlerType: HandlerType.APT_CALL
            }
          }
        }
      }
    }
    return undefined
  }

  testEvent(transaction: Transaction_UserTransaction, network: AptosNetwork = AptosNetwork.MAIN_NET) {
    const binding = this.buildEventBinding(transaction, network)
    if (!binding) {
      throw Error('Invalid test event: ' + JSON.stringify(transaction))
    }
    return this.server.processBinding(binding)
  }

  private buildEventBinding(
    transaction: Transaction_UserTransaction,
    network: AptosNetwork = AptosNetwork.MAIN_NET
  ): DataBinding | undefined {
    // const allEvents = new Set(transaction.events.map(e => e.type))
    for (const config of this.server.contractConfigs) {
      if (config.contract?.chainId !== network) {
        continue
      }
      for (const eventConfig of config.moveEventConfigs) {
        for (const eventFilter of eventConfig.filters) {
          for (const event of transaction.events) {
            if (
              accountTypeString(config.contract.address) + '::' + eventFilter.type ===
              parseMoveType(event.type).qname
            ) {
              return {
                data: {
                  aptEvent: {
                    transaction
                  }
                },
                handlerIds: [eventConfig.handlerId],
                handlerType: HandlerType.APT_EVENT
              }
            }
          }
        }
      }
    }
    return undefined
  }
}
