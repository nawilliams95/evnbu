import { EventBus } from '../src/index'
let eventBus: EventBus

beforeEach(() => {
  eventBus = new EventBus()
})

describe('Event Bus', () => {
  describe('Initialize class instance', () => {
    test('initialize with default config', () => {
      expect(eventBus.channel('*').getMaxListeners()).toBe(0)
    })

    test('Initialize with custom config', () => {
      const max = 11

      const eventBus = new EventBus({ maxListeners: max })

      expect(eventBus.mainChannel().getMaxListeners()).toBe(max)
    })
  })

  describe('Create and remove channels', () => {
    test('create channel', () => {
      const channelName = 'test'

      eventBus.channel(channelName)

      expect(eventBus.hasChannel(channelName)).toBe(true)
    })

    test('remove channel', () => {
      const channelName = 'test'
      const channel = eventBus.channel(channelName)
      const channelDestroySpy = jest.spyOn(channel, 'destroy')

      const removed = eventBus.removeChannel(channelName)

      expect(channelDestroySpy).toBeCalled()
      expect(eventBus.hasChannel(channelName)).toBe(false)
      expect(removed).toBe(true)
    })

    test('remove channel that does not exist ', () => {
      const removed = eventBus.removeChannel('test')

      expect(removed).toBe(false)
    })
    test('get default channel via mainChannel()', () => {
      const channel = eventBus.mainChannel()

      expect(channel).toBe(eventBus.channel('*'))
    })

    test('throw if someone tries to remove the default channel', () => {
      const defaultChannelName = '*'

      expect(() => {
        eventBus.removeChannel(defaultChannelName)
      }).toThrow()
    })
    test('List all available channels', () => {
      eventBus.channel('1')
      eventBus.channel('2')
      eventBus.channel('3')

      const channels = eventBus.getAllChannels()
      // there is always the default channel
      expect(channels.length).toBe(4)
    })
  })
  describe('Default channel', () => {
    test("recreate default channel if it's destroyed", () => {
      const listener = jest.fn()
      eventBus.mainChannel().on(listener)
      const listenerCount = eventBus.mainChannel().listenerCount()

      eventBus.mainChannel().destroy()
      eventBus.mainChannel().emit('test')

      expect(eventBus.mainChannel().listenerCount()).toBe(listenerCount - 1)
      expect(listener).not.toBeCalled()
    })
    test('allChannels() is alias for mainChannel()', () => {
      const mainChannel = eventBus.mainChannel()
      const allChannels = eventBus.allChannels()
      expect(mainChannel).toBe(allChannels)
    })
    describe('Reemit payloads on default channel ', () => {
      test('reemit when streamed directly from channel', () => {
        const payload = {
          propOne: 'one',
        }
        const channelName = 'test'
        const listener = jest.fn()
        const channel = eventBus.channel(channelName)
        eventBus.mainChannel().addListener(listener)
        const payLoadEvent = {
          channel: channelName,
          topic: '*',
          payload: payload,
        }

        channel.emit(payload)

        expect(listener).toBeCalledWith(expect.objectContaining(payLoadEvent))
      })

      test('reemit on default channel when streamed from topic', () => {
        const payload = {
          propOne: 'one',
        }
        const channelName = 'rocket_launcher'
        const topicName = 'rocket_fired'
        const listener = jest.fn()
        const channel = eventBus.channel(channelName)
        const topic = channel.topic(topicName)
        eventBus.channel('*').addListener(listener)
        const payLoadEvent = {
          channel: channelName,
          topic: topicName,
          payload: payload,
        }

        topic.emit(payload)

        expect(listener).toBeCalledWith(expect.objectContaining(payLoadEvent))
      })
      test('reemit to listeners on particular topic from any channel', () => {
        const payload = {
          propOne: 'one',
        }
        const topicListener = jest.fn()
        const channelOneName = 'rocket_launcher'
        const channelTwoName = 'rocket_launcher_ultra'
        const topicName = 'rocket_fired'
        const channelOne = eventBus.channel(channelOneName)
        const channelTwo = eventBus.channel(channelTwoName)
        const payLoadOneEvent = {
          channel: channelOneName,
          topic: topicName,
          payload: payload,
        }
        const payLoadTwoEvent = {
          channel: channelTwoName,
          topic: topicName,
          payload: payload,
        }
        // two different channels with the same topic
        const topicOne = channelOne.topic(topicName)
        const topicTwo = channelTwo.topic(topicName)

        // add listener to default channel
        var defaultChannelTopic = eventBus.channel('*').topic(topicName)

        defaultChannelTopic.addListener(topicListener)

        topicOne.emit(payload)
        topicTwo.emit(payload)

        expect(topicListener.mock.calls[0][0]).toEqual(
          expect.objectContaining(payLoadOneEvent)
        )
        expect(topicListener.mock.calls[1][0]).toEqual(
          expect.objectContaining(payLoadTwoEvent)
        )
      })

      test('reemit to listeners on particular topic from any channel only once', () => {
        const payload = {
          propOne: 'one',
        }
        const topicListener = jest.fn()
        const channelOneName = 'rocket_launcher'
        const channelTwoName = 'rocket_launcher_ultra'
        const topicName = 'rocket_fired'
        const channelOne = eventBus.channel(channelOneName)
        const channelTwo = eventBus.channel(channelTwoName)
        const payLoadOneEvent = {
          channel: channelOneName,
          topic: topicName,
          payload: payload,
        }
        // two different channels with the same topic
        const topicOne = channelOne.topic(topicName)
        const topicTwo = channelTwo.topic(topicName)

        // add listener to default channel
        var defaultChannelTopic = eventBus.channel('*').topic(topicName)

        defaultChannelTopic.once(topicListener)

        topicOne.emit(payload)
        topicTwo.emit(payload)
        topicOne.emit(payload)
        topicTwo.emit(payload)

        expect(topicListener).toBeCalledTimes(1)
        expect(topicListener.mock.calls[0][0]).toEqual(
          expect.objectContaining(payLoadOneEvent)
        )
      })
    })
  })
  describe('Destroy class instance', () => {
    test('clean up references', () => {
      const defaultChannel = eventBus.channel('*')
      const testChannel = eventBus.channel('test')
      const spyOne = jest.spyOn(defaultChannel, 'destroy')
      const spyTwo = jest.spyOn(testChannel, 'destroy')

      eventBus.destroy()

      expect(spyOne).toBeCalled()
      expect(spyTwo).toBeCalled()
    })
  })
})
