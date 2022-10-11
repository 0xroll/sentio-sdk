import { AptosBaseProcessor, AptosBindOptions } from '@sentio/sdk'

class Souffl3 extends AptosBaseProcessor {
  static bind(options: AptosBindOptions): Souffl3 {
    if (options && !options.name) {
      options.name = 'souffl3'
    }
    return new Souffl3(options)
  }
}

Souffl3.bind({
  startBlock: 6604913,
  address: '0x4188c8694687e844677c2aa87171019e23d61cac60de5082a278a8aa47e9d807',
})
  .onTransaction((txn, ctx) => {
    if (txn.events) {
      for (const event of txn.events) {
        if (event && event.type === '0x3::token::DepositEvent') {
          ctx.meter.Counter('deposit_token_count').add(Number(event.data.amount))
        }
      }
    }
  })
  .onCall(
    (call, ctx) => {
      ctx.meter.Counter('call_num').add(1)
    },
    {
      function: 'SouffleChefCampaign::pull_token_v2',
      typeArguments: undefined,
    }
  )
  .onEvent(
    (event, ctx) => {
      ctx.meter.Counter('evt_num').add(1)
    },
    {
      type: '0x1::coin::DepositEvent',
    }
  )
